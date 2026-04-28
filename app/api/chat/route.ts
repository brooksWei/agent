import { NextResponse } from "next/server";
import { z } from "zod";

import { getSharedRuntime, runTurn } from "../../../src/server/agentRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatRequestSchema = z.object({
  message: z.string().min(1, "message is required"),
  threadId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = ChatRequestSchema.parse(await request.json());
    const runtimeState = await getSharedRuntime();
    const result = await runTurn(runtimeState, {
      threadId: body.threadId,
      userInput: body.message,
    });

    return NextResponse.json({
      ok: true,
      threadId: result.threadId,
      reply: result.reply,
      meta: {
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
  }
}
