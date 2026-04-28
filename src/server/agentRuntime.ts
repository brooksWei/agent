import { randomUUID } from "node:crypto";

import type { BaseMessage } from "@langchain/core/messages";

import { buildAgent, type AgentModelConfig } from "../agent/buildAgent";
import { resolveEnv, type AgentEnv } from "../config/env";
import { McpManager } from "../mcp/mcpManager";
import { MilvusMemory } from "../memory/milvusMemory";
import { setupModelProxy, type ModelProxyStatus } from "../network/modelProxy";
import {
  renderCheckDesignPrompt,
  renderModelLimitBlockedReport,
  renderRecursionBlockedReport,
} from "../prompts/templates";
import { extractLatestAIText } from "../utils/message";

const DEFAULT_CHECK_DESIGN_RECURSION_LIMIT = 600;
const DEFAULT_CHECK_DESIGN_THREAD_PREFIX = "check-design";
const EMPTY_MODEL_REPLY = "(No text response returned.)";

type BuiltAgent = Awaited<ReturnType<typeof buildAgent>>["agent"];
type BuildAgentResult = Awaited<ReturnType<typeof buildAgent>>;

export type RuntimeModelMeta = BuildAgentResult["modelMeta"];

export type AgentRuntime = {
  env: AgentEnv;
  proxyStatus: ModelProxyStatus;
  memory: MilvusMemory;
  mcpManager: McpManager;
  agent: BuiltAgent;
  toolCount: number;
  modelMeta: RuntimeModelMeta;
};

export type RuntimeOptions = {
  modelConfig?: AgentModelConfig;
};

export type RunCheckDesignInput = {
  design: string;
  url: string;
  viewport?: string;
  extra?: string;
  threadId?: string;
  recursionLimit?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __sharedAgentRuntimePromiseMap:
    | Map<string, Promise<AgentRuntime>>
    | undefined;
}

function createThreadId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function isGraphRecursionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "GraphRecursionError" ||
    /recursion limit/i.test(error.message)
  );
}

function normalizeModelConfig(config?: AgentModelConfig): AgentModelConfig | undefined {
  if (!config) {
    return undefined;
  }

  const normalized: AgentModelConfig = {};
  if (config.provider) {
    normalized.provider = config.provider;
  }
  if (config.model?.trim()) {
    normalized.model = config.model.trim();
  }
  if (config.apiKey?.trim()) {
    normalized.apiKey = config.apiKey.trim();
  }
  if (config.baseUrl?.trim()) {
    normalized.baseUrl = config.baseUrl.trim();
  }
  if (typeof config.temperature === "number" && !Number.isNaN(config.temperature)) {
    normalized.temperature = config.temperature;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function createRuntimeKey(options?: RuntimeOptions): string {
  const modelConfig = normalizeModelConfig(options?.modelConfig);
  return JSON.stringify(modelConfig ?? { provider: "env-default" });
}

async function initRuntime(options?: RuntimeOptions): Promise<AgentRuntime> {
  const env = resolveEnv();
  const modelConfig = normalizeModelConfig(options?.modelConfig);
  const proxyStatus = setupModelProxy(env);
  const memory = await MilvusMemory.create(env);
  const mcpManager = new McpManager();
  await mcpManager.connectFromFile(env.mcpServersFile);

  const { agent, toolCount, modelMeta } = await buildAgent({
    env,
    memory,
    mcpManager,
    modelRunLimit: 260,
    toolRunLimit: 420,
    modelConfig,
  });

  return {
    env,
    proxyStatus,
    memory,
    mcpManager,
    agent,
    toolCount,
    modelMeta,
  };
}

export async function getSharedRuntime(options?: RuntimeOptions): Promise<AgentRuntime> {
  const normalizedConfig = normalizeModelConfig(options?.modelConfig);
  if (normalizedConfig?.apiKey) {
    // Avoid caching runtime instances that carry request-scoped secrets.
    return initRuntime({ modelConfig: normalizedConfig });
  }

  if (!globalThis.__sharedAgentRuntimePromiseMap) {
    globalThis.__sharedAgentRuntimePromiseMap = new Map();
  }

  const key = createRuntimeKey({ modelConfig: normalizedConfig });
  const map = globalThis.__sharedAgentRuntimePromiseMap;
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const runtimePromise = initRuntime({ modelConfig: normalizedConfig }).catch((error) => {
    map.delete(key);
    throw error;
  });
  map.set(key, runtimePromise);
  return runtimePromise;
}

export async function createRuntime(options?: RuntimeOptions): Promise<AgentRuntime> {
  return initRuntime(options);
}

export async function closeRuntime(runtime: AgentRuntime): Promise<void> {
  await runtime.mcpManager.closeAll();
}

export function getOrCreateCheckDesignThreadId(threadId?: string): string {
  return threadId?.trim() || createThreadId(DEFAULT_CHECK_DESIGN_THREAD_PREFIX);
}

export async function runCheckDesign(
  runtime: AgentRuntime,
  input: RunCheckDesignInput
): Promise<{
  threadId: string;
  output: string;
  recursionLimited: boolean;
  recursionLimit: number;
}> {
  const threadId = getOrCreateCheckDesignThreadId(input.threadId);
  const viewport = input.viewport?.trim() || "1440x900";
  const recursionLimit =
    input.recursionLimit ?? DEFAULT_CHECK_DESIGN_RECURSION_LIMIT;
  const basePromptInput = {
    design: input.design,
    url: input.url,
    viewport,
    extra: input.extra,
  };
  const prompt = await renderCheckDesignPrompt(basePromptInput);

  try {
    const result = (await runtime.agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        configurable: {
          thread_id: threadId,
        },
        recursionLimit,
      }
    )) as { messages?: BaseMessage[] };

    const report = extractLatestAIText(result.messages ?? []).trim();
    const output =
      report === ""
        ? EMPTY_MODEL_REPLY
        : /model call limits exceeded/i.test(report)
          ? await renderModelLimitBlockedReport({
              ...basePromptInput,
              detail: report,
            })
          : report;

    return {
      threadId,
      output,
      recursionLimited: false,
      recursionLimit,
    };
  } catch (error) {
    if (!isGraphRecursionError(error)) {
      throw error;
    }

    const output = await renderRecursionBlockedReport({
      ...basePromptInput,
      recursionLimit,
      detail: error instanceof Error ? error.message : String(error),
    });

    return {
      threadId,
      output,
      recursionLimited: true,
      recursionLimit,
    };
  }
}
