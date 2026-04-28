import { ChatGoogle } from "@langchain/google";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  createMiddleware,
  createAgent,
  modelCallLimitMiddleware,
  tool,
  toolCallLimitMiddleware,
} from "langchain";
import { z } from "zod";

import type { AgentEnv, ModelProvider } from "../config/env";
import type { McpManager } from "../mcp/mcpManager";
import type { MilvusMemory } from "../memory/milvusMemory";
import { renderAgentSystemPrompt } from "../prompts/templates";
import { emitToolCallEvent } from "../server/toolCallBus";
import { createMemoryTools } from "../tools/memoryTools";

export type AgentModelConfig = {
  provider?: ModelProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
};

type BuildAgentInput = {
  env: AgentEnv;
  memory: MilvusMemory;
  mcpManager: McpManager;
  modelRunLimit?: number;
  toolRunLimit?: number;
  modelConfig?: AgentModelConfig;
};

function stringifyForLog(value: unknown, maxLength = 2000): string {
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...(truncated)`;
}

function normalizeTemperature(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0.2;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 2) {
    return 2;
  }
  return value;
}

function createChatModel(env: AgentEnv, config?: AgentModelConfig) {
  const provider = config?.provider ?? env.modelProvider;
  const temperature = normalizeTemperature(config?.temperature);

  if (provider === "deepseek") {
    const apiKey = config?.apiKey?.trim() || env.deepseekApiKey;
    if (!apiKey) {
      throw new Error(
        "DeepSeek model selected but API key is missing. " +
          "Set DEEPSEEK_API_KEY or pass modelConfig.apiKey."
      );
    }

    const model = config?.model?.trim() || env.deepseekModel;
    const baseURL = config?.baseUrl?.trim() || env.deepseekBaseUrl;
    const thinkingMode = env.deepseekThinkingMode;

    return new ChatOpenAI({
      model,
      apiKey,
      temperature,
      modelKwargs: {
        // Keep DeepSeek v4 tool-calling stable in multi-turn agent loops.
        thinking: { type: thinkingMode },
      },
      configuration: {
        baseURL,
      },
    });
  }

  const geminiApiKey = config?.apiKey?.trim() || env.googleApiKey;
  if (!geminiApiKey) {
    throw new Error(
      "Gemini model selected but API key is missing. " +
        "Set GOOGLE_API_KEY or pass modelConfig.apiKey."
    );
  }

  return new ChatGoogle({
    apiKey: geminiApiKey,
    model: config?.model?.trim() || env.geminiModel,
    temperature,
  });
}

export function resolveModelMeta(env: AgentEnv, config?: AgentModelConfig): {
  provider: ModelProvider;
  model: string;
  baseUrl?: string;
} {
  const provider = config?.provider ?? env.modelProvider;
  if (provider === "deepseek") {
    return {
      provider,
      model: config?.model?.trim() || env.deepseekModel,
      baseUrl: config?.baseUrl?.trim() || env.deepseekBaseUrl,
    };
  }
  return {
    provider,
    model: config?.model?.trim() || env.geminiModel,
  };
}

export async function buildAgent(input: BuildAgentInput) {
  const modelLimit = modelCallLimitMiddleware({
    runLimit: input.modelRunLimit ?? 120,
    exitBehavior: "end",
  });

  const toolLimit = toolCallLimitMiddleware({
    runLimit: input.toolRunLimit ?? 180,
    exitBehavior: "continue",
  });

  const model = createChatModel(input.env, input.modelConfig);
  const toolArgLogger = createMiddleware({
    name: "tool_arg_logger",
    wrapToolCall: async (request, handler) => {
      const argsText = stringifyForLog(request.toolCall.args, 60_000);
      const threadId = request.runtime.configurable?.thread_id;
      if (typeof threadId === "string" && threadId.trim() !== "") {
        emitToolCallEvent({
          threadId,
          name: request.toolCall.name,
          argsText,
          at: new Date().toISOString(),
        });
      }
      console.log(`[Tool Call] name=${request.toolCall.name}, args=${argsText}`);
      return handler(request);
    },
  });

  const currentTimeTool = tool(async () => new Date().toISOString(), {
    name: "current_time",
    description: "Get current time in ISO format.",
    schema: z.object({}),
  });

  const memoryTools = createMemoryTools(input.memory);
  const mcpTools = await input.mcpManager.getLangChainTools();
  const tools = [currentTimeTool, ...memoryTools, ...mcpTools];
  const systemPrompt = await renderAgentSystemPrompt();

  const agent = createAgent({
    model,
    tools,
    middleware: [toolArgLogger, modelLimit, toolLimit],
    checkpointer: new MemorySaver(),
    systemPrompt,
  });

  return {
    agent,
    model,
    toolCount: tools.length,
    modelMeta: resolveModelMeta(input.env, input.modelConfig),
  };
}
