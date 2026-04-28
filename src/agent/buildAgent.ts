import { MemorySaver } from "@langchain/langgraph";
import { ChatGoogle } from "@langchain/google";
import {
  createAgent,
  modelCallLimitMiddleware,
  tool,
  toolCallLimitMiddleware,
} from "langchain";
import { z } from "zod";

import type { AgentEnv } from "../config/env";
import type { McpManager } from "../mcp/mcpManager";
import type { MilvusMemory } from "../memory/milvusMemory";
import { renderAgentSystemPrompt } from "../prompts/templates";
import { createMemoryTools } from "../tools/memoryTools";

type BuildAgentInput = {
  env: AgentEnv;
  memory: MilvusMemory;
  mcpManager: McpManager;
  modelRunLimit?: number;
  toolRunLimit?: number;
};

export async function buildAgent(input: BuildAgentInput) {
  const modelLimit = modelCallLimitMiddleware({
    runLimit: input.modelRunLimit ?? 120,
    exitBehavior: "end",
  });

  const toolLimit = toolCallLimitMiddleware({
    runLimit: input.toolRunLimit ?? 180,
    exitBehavior: "continue",
  });

  const model = new ChatGoogle({
    apiKey: input.env.googleApiKey,
    model: input.env.geminiModel,
    temperature: 0.2,
  });

  const currentTimeTool = tool(
    async () => new Date().toISOString(),
    {
      name: "current_time",
      description: "Get current time in ISO format.",
      schema: z.object({}),
    }
  );

  const memoryTools = createMemoryTools(input.memory);
  const mcpTools = await input.mcpManager.getLangChainTools();
  const tools = [currentTimeTool, ...memoryTools, ...mcpTools];
  const systemPrompt = await renderAgentSystemPrompt();

  const agent = createAgent({
    model,
    tools,
    middleware: [modelLimit, toolLimit],
    checkpointer: new MemorySaver(),
    systemPrompt,
  });

  return {
    agent,
    toolCount: tools.length,
  };
}
