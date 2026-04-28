import { randomUUID } from "node:crypto";

import type { BaseMessage } from "@langchain/core/messages";

import { buildAgent } from "../agent/buildAgent";
import { resolveEnv, type AgentEnv } from "../config/env";
import { McpManager } from "../mcp/mcpManager";
import { MilvusMemory } from "../memory/milvusMemory";
import { setupModelProxy, type ModelProxyStatus } from "../network/modelProxy";
import {
  renderCheckDesignPrompt,
  renderModelLimitBlockedReport,
  renderRecursionBlockedReport,
  renderRunTurnMemoryContextPrompt,
} from "../prompts/templates";
import { extractLatestAIText } from "../utils/message";

const DEFAULT_CHECK_DESIGN_RECURSION_LIMIT = 600;
const DEFAULT_THREAD_PREFIX = "thread";
const DEFAULT_CHECK_DESIGN_THREAD_PREFIX = "check-design";
const EMPTY_MODEL_REPLY = "(No text response returned.)";

type BuiltAgent = Awaited<ReturnType<typeof buildAgent>>["agent"];

export type AgentRuntime = {
  env: AgentEnv;
  proxyStatus: ModelProxyStatus;
  memory: MilvusMemory;
  mcpManager: McpManager;
  agent: BuiltAgent;
  toolCount: number;
};

export type RunTurnInput = {
  threadId?: string;
  userInput: string;
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
  var __sharedAgentRuntimePromise: Promise<AgentRuntime> | undefined;
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

async function initRuntime(): Promise<AgentRuntime> {
  const env = resolveEnv();
  const proxyStatus = setupModelProxy(env);
  const memory = await MilvusMemory.create(env);
  const mcpManager = new McpManager();
  await mcpManager.connectFromFile(env.mcpServersFile);

  const { agent, toolCount } = await buildAgent({
    env,
    memory,
    mcpManager,
    modelRunLimit: 260,
    toolRunLimit: 420,
  });

  return {
    env,
    proxyStatus,
    memory,
    mcpManager,
    agent,
    toolCount,
  };
}

export async function getSharedRuntime(): Promise<AgentRuntime> {
  if (!globalThis.__sharedAgentRuntimePromise) {
    globalThis.__sharedAgentRuntimePromise = initRuntime().catch((error) => {
      globalThis.__sharedAgentRuntimePromise = undefined;
      throw error;
    });
  }
  return globalThis.__sharedAgentRuntimePromise;
}

export async function createRuntime(): Promise<AgentRuntime> {
  return initRuntime();
}

export async function closeRuntime(runtime: AgentRuntime): Promise<void> {
  await runtime.mcpManager.closeAll();
}

export function getOrCreateThreadId(threadId?: string): string {
  return threadId?.trim() || createThreadId(DEFAULT_THREAD_PREFIX);
}

export function getOrCreateCheckDesignThreadId(threadId?: string): string {
  return threadId?.trim() || createThreadId(DEFAULT_CHECK_DESIGN_THREAD_PREFIX);
}

export async function runTurn(
  runtime: AgentRuntime,
  input: RunTurnInput
): Promise<{ threadId: string; reply: string }> {
  const threadId = getOrCreateThreadId(input.threadId);
  const userInput = input.userInput.trim();

  if (!userInput) {
    return { threadId, reply: EMPTY_MODEL_REPLY };
  }

  await runtime.memory.addMemory({
    threadId,
    role: "user",
    content: userInput,
    source: "chat",
  });

  const recalled = await runtime.memory.searchMemory({
    query: userInput,
    threadId,
    topK: 3,
  });
  const recalledContext =
    recalled.length > 0
      ? recalled
          .map((item, index) => `${index + 1}. [${item.role}] ${item.content}`)
          .join("\n")
      : "No relevant long-term memory.";
  const memoryContextPrompt =
    await renderRunTurnMemoryContextPrompt(recalledContext);

  const result = (await runtime.agent.invoke(
    {
      messages: [
        {
          role: "system",
          content: memoryContextPrompt,
        },
        {
          role: "user",
          content: userInput,
        },
      ],
    },
    {
      configurable: {
        thread_id: threadId,
      },
    }
  )) as { messages?: BaseMessage[] };

  const reply = extractLatestAIText(result.messages ?? []).trim();
  const finalReply = reply || EMPTY_MODEL_REPLY;

  if (reply !== "") {
    await runtime.memory.addMemory({
      threadId,
      role: "assistant",
      content: reply,
      source: "chat",
    });
  }

  return { threadId, reply: finalReply };
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
