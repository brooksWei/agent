import { MemorySaver } from "@langchain/langgraph";
import { ChatGoogle } from "@langchain/google";
import { tool, createAgent } from "langchain";
import { z } from "zod";

import type { AgentEnv } from "../config/env.js";
import type { McpManager } from "../mcp/mcpManager.js";
import type { MilvusMemory } from "../memory/milvusMemory.js";
import { renderAgentSystemPrompt } from "../prompts/templates.js";
import { createMemoryTools } from "../tools/memoryTools.js";

type BuildAgentInput = {
  env: AgentEnv;
  memory: MilvusMemory;
  mcpManager: McpManager;
};

export async function buildAgent(input: BuildAgentInput) {
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
    checkpointer: new MemorySaver(),
    systemPrompt,
  });

  return {
    agent,
    toolCount: tools.length,
  };
}
