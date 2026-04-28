import { NextResponse } from "next/server";
import { z } from "zod";

import {
  closeRuntime,
  createRuntime,
  getOrCreateCheckDesignThreadId,
  getSharedRuntime,
  runCheckDesign,
} from "../../../../src/server/agentRuntime";
import { subscribeToolCallEvents } from "../../../../src/server/toolCallBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ModelConfigSchema = z
  .object({
    provider: z.enum(["gemini", "deepseek"]).optional(),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .optional();

const CheckDesignSchema = z.object({
  design: z.string().min(1, "design is required"),
  url: z.string().min(1, "url is required"),
  viewport: z.string().optional(),
  threadId: z.string().optional(),
  extra: z.string().optional(),
  recursionLimit: z.number().int().min(20).max(2000).optional(),
  modelConfig: ModelConfigSchema,
});

function createSsePayload(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  let body: z.infer<typeof CheckDesignSchema>;
  try {
    body = CheckDesignSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues.map((item) => item.message).join("; "),
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  const threadId = getOrCreateCheckDesignThreadId(body.threadId);
  const hasInlineApiKey = Boolean(body.modelConfig?.apiKey?.trim());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(createSsePayload(event, data)));
      };

      void (async () => {
        let runtimeToClose: Awaited<ReturnType<typeof createRuntime>> | undefined;
        let toolCallCount = 0;
        let unsubscribe = () => {};

        try {
          const runtimeState = hasInlineApiKey
            ? await createRuntime({
                modelConfig: body.modelConfig,
              })
            : await getSharedRuntime({
                modelConfig: body.modelConfig,
              });

          if (hasInlineApiKey) {
            runtimeToClose = runtimeState;
          }

          unsubscribe = subscribeToolCallEvents(threadId, (event) => {
            toolCallCount += 1;
            send("tool_call", {
              index: toolCallCount,
              ...event,
            });
          });

          send("meta", {
            threadId,
            model: runtimeState.modelMeta,
            tools: runtimeState.toolCount,
            mcpServers: runtimeState.mcpManager.connectedServerCount(),
            milvusAvailable: runtimeState.memory.isAvailable(),
          });

          const result = await runCheckDesign(runtimeState, {
            ...body,
            threadId,
          });

          send("done", {
            ok: true,
            threadId: result.threadId,
            output: result.output,
            recursionLimited: result.recursionLimited,
            recursionLimit: result.recursionLimit,
          });
        } catch (error) {
          send("error", {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          unsubscribe();
          if (runtimeToClose) {
            await closeRuntime(runtimeToClose);
          }
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

