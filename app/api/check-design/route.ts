import { NextResponse } from "next/server";
import { z } from "zod";

import {
  closeRuntime,
  createRuntime,
  getSharedRuntime,
  runCheckDesign,
} from "../../../src/server/agentRuntime";

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

export async function POST(request: Request) {
  let runtimeToClose: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    const body = CheckDesignSchema.parse(await request.json());
    const hasInlineApiKey = Boolean(body.modelConfig?.apiKey?.trim());
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
    const result = await runCheckDesign(runtimeState, body);

    return NextResponse.json({
      ok: true,
      threadId: result.threadId,
      output: result.output,
      recursionLimited: result.recursionLimited,
      recursionLimit: result.recursionLimit,
      meta: {
        model: runtimeState.modelMeta,
        tools: runtimeState.toolCount,
        mcpServers: runtimeState.mcpManager.connectedServerCount(),
        milvusAvailable: runtimeState.memory.isAvailable(),
      },
    });
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
  } finally {
    if (runtimeToClose) {
      await closeRuntime(runtimeToClose);
    }
  }
}
