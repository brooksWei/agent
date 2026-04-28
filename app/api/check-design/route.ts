import { NextResponse } from "next/server";
import { z } from "zod";

import { getSharedRuntime, runCheckDesign } from "../../../src/server/agentRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CheckDesignSchema = z.object({
  design: z.string().min(1, "design is required"),
  url: z.string().min(1, "url is required"),
  viewport: z.string().optional(),
  threadId: z.string().optional(),
  extra: z.string().optional(),
  recursionLimit: z.number().int().min(20).max(2000).optional(),
});

export async function POST(request: Request) {
  try {
    const body = CheckDesignSchema.parse(await request.json());
    const runtimeState = await getSharedRuntime();
    const result = await runCheckDesign(runtimeState, body);

    return NextResponse.json({
      ok: true,
      threadId: result.threadId,
      output: result.output,
      recursionLimited: result.recursionLimited,
      recursionLimit: result.recursionLimit,
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
