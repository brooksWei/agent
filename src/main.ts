import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { BaseMessage } from "@langchain/core/messages";

import { buildAgent } from "./agent/buildAgent.js";
import { resolveEnv } from "./config/env.js";
import { McpManager } from "./mcp/mcpManager.js";
import { MilvusMemory } from "./memory/milvusMemory.js";
import { renderRunTurnMemoryContextPrompt } from "./prompts/templates.js";
import { extractLatestAIText } from "./utils/message.js";

type ParsedArgs = {
  threadId: string;
  prompt: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  let threadId: string | undefined;
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--thread" && i + 1 < argv.length) {
      threadId = argv[i + 1];
      i += 1;
      continue;
    }
    promptParts.push(current);
  }

  return {
    threadId: threadId || `thread-${randomUUID()}`,
    prompt: promptParts.join(" ").trim(),
  };
}

async function runTurn(
  agent: Awaited<ReturnType<typeof buildAgent>>["agent"],
  memory: MilvusMemory,
  threadId: string,
  userInput: string
): Promise<string> {
  await memory.addMemory({
    threadId,
    role: "user",
    content: userInput,
    source: "chat",
  });

  const recalled = await memory.searchMemory({
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

  const result = (await agent.invoke(
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

  const reply = extractLatestAIText(result.messages ?? []);

  if (reply.trim() !== "") {
    await memory.addMemory({
      threadId,
      role: "assistant",
      content: reply,
      source: "chat",
    });
  }

  return reply || "(No text response returned.)";
}

async function main() {
  const env = resolveEnv();
  const args = parseArgs(process.argv.slice(2));

  const memory = await MilvusMemory.create(env);
  const mcpManager = new McpManager();
  await mcpManager.connectFromFile(env.mcpServersFile);

  const { agent, toolCount } = await buildAgent({
    env,
    memory,
    mcpManager,
  });

  console.log(
    `[Agent Ready] thread=${args.threadId}, tools=${toolCount}, mcpServers=${mcpManager.connectedServerCount()}, milvusAvailable=${memory.isAvailable()}, milvusTimeoutMs=${memory.timeoutMs()}`
  );

  try {
    if (args.prompt) {
      const answer = await runTurn(agent, memory, args.threadId, args.prompt);
      console.log(`\nAssistant > ${answer}`);
      return;
    }

    const rl = createInterface({ input, output });
    console.log("Type your message, use 'exit' to quit.");

    while (true) {
      const question = await rl.question("\nYou > ");
      const userInput = question.trim();

      if (!userInput) {
        continue;
      }
      if (["exit", "quit", "q"].includes(userInput.toLowerCase())) {
        break;
      }

      const answer = await runTurn(agent, memory, args.threadId, userInput);
      console.log(`\nAssistant > ${answer}`);
    }

    rl.close();
  } finally {
    await mcpManager.closeAll();
  }
}

main().catch((error) => {
  console.error(
    `[Fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  );
  process.exitCode = 1;
});
