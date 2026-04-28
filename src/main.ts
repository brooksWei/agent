import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  closeRuntime,
  createRuntime,
  getOrCreateThreadId,
  runTurn,
} from "./server/agentRuntime";

type ParsedArgs = {
  threadId?: string;
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
    threadId,
    prompt: promptParts.join(" ").trim(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtime = await createRuntime();
  const sessionThreadId = getOrCreateThreadId(args.threadId);

  console.log(
    `[Model Proxy] enabled=${runtime.proxyStatus.enabled}, ${runtime.proxyStatus.proxyUrl ? `url=${runtime.proxyStatus.proxyUrl}, ` : ""}status=${runtime.proxyStatus.message}`
  );

  console.log(
    `[Agent Ready] thread=${sessionThreadId}, tools=${runtime.toolCount}, mcpServers=${runtime.mcpManager.connectedServerCount()}, milvusAvailable=${runtime.memory.isAvailable()}, milvusTimeoutMs=${runtime.memory.timeoutMs()}`
  );

  try {
    if (args.prompt) {
      const result = await runTurn(runtime, {
        threadId: sessionThreadId,
        userInput: args.prompt,
      });
      console.log(`\nAssistant > ${result.reply}`);
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

      const result = await runTurn(runtime, {
        threadId: sessionThreadId,
        userInput,
      });
      console.log(`\nAssistant > ${result.reply}`);
    }

    rl.close();
  } finally {
    await closeRuntime(runtime);
  }
}

main().catch((error) => {
  console.error(
    `[Fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  );
  process.exitCode = 1;
});
