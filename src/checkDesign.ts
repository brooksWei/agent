import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { BaseMessage } from "@langchain/core/messages";

import { buildAgent } from "./agent/buildAgent.js";
import { resolveEnv } from "./config/env.js";
import { McpManager } from "./mcp/mcpManager.js";
import { MilvusMemory } from "./memory/milvusMemory.js";
import { setupModelProxy } from "./network/modelProxy.js";
import {
  renderCheckDesignPrompt,
  renderModelLimitBlockedReport,
  renderRecursionBlockedReport,
} from "./prompts/templates.js";
import { extractLatestAIText } from "./utils/message.js";

const CHECK_DESIGN_RECURSION_LIMIT = 300;

type CheckDesignArgs = {
  design: string;
  url: string;
  threadId: string;
  viewport: string;
  outPath?: string;
  extra?: string;
};

function isGraphRecursionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "GraphRecursionError" ||
    /recursion limit/i.test(error.message)
  );
}

function parseCheckDesignArgs(argv: string[]): CheckDesignArgs {
  let design = "";
  let url = "";
  let threadId = `check-design-${randomUUID()}`;
  let viewport = "1440x900";
  let outPath: string | undefined;
  let extra: string | undefined;
  let threadSet = false;
  let viewportSet = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "--design") {
      if (!next) throw new Error("Missing value for --design");
      design = next;
      i += 1;
      continue;
    }
    if (current === "--url") {
      if (!next) throw new Error("Missing value for --url");
      url = next;
      i += 1;
      continue;
    }
    if (current === "--thread") {
      if (!next) throw new Error("Missing value for --thread");
      threadId = next;
      threadSet = true;
      i += 1;
      continue;
    }
    if (current === "--viewport") {
      if (!next) throw new Error("Missing value for --viewport");
      viewport = next;
      viewportSet = true;
      i += 1;
      continue;
    }
    if (current === "--out") {
      if (!next) throw new Error("Missing value for --out");
      outPath = next;
      i += 1;
      continue;
    }
    if (current === "--extra") {
      if (!next) throw new Error("Missing value for --extra");
      extra = next;
      i += 1;
      continue;
    }

    if (current.startsWith("--")) {
      throw new Error(`Unknown argument: ${current}`);
    }
    positional.push(current);
  }

  if (!design && positional.length > 0) {
    design = positional.shift() as string;
  }
  if (!url && positional.length > 0) {
    url = positional.shift() as string;
  }
  if (!threadSet && positional.length > 0) {
    threadId = positional.shift() as string;
  }
  if (!viewportSet && positional.length > 0) {
    viewport = positional.shift() as string;
  }
  if (!outPath && positional.length > 0) {
    outPath = positional.shift();
  }
  if (!extra && positional.length > 0) {
    extra = positional.join(" ");
  }

  if (!design || !url) {
    throw new Error("Both --design and --url are required.");
  }

  return {
    design,
    url,
    threadId,
    viewport,
    outPath,
    extra,
  };
}

function usage() {
  console.log(
    [
      "Usage:",
      "npm run check-design -- --design <mastergo_link_or_id> --url <page_url> [--thread <id>] [--viewport <WxH>] [--out <report.md>] [--extra \"notes\"]",
      "npm run check-design -- <mastergo_link_or_id> <page_url> [thread] [viewport] [outPath] [extra]",
      "",
      "Example:",
      "npm run check-design -- --design \"https://mastergo.com/file/...\" --url \"http://localhost:3000\" --viewport 1440x900 --out ./reports/design-check.md",
      "npm run check-design -- \"https://mastergo.com/file/...\" \"http://localhost:3000\"",
    ].join("\n")
  );
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  let args: CheckDesignArgs;
  try {
    args = parseCheckDesignArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Args Error] ${message}`);
    usage();
    process.exitCode = 1;
    return;
  }

  const env = resolveEnv();
  const proxyStatus = setupModelProxy(env);
  const memory = await MilvusMemory.create(env);
  const mcpManager = new McpManager();
  await mcpManager.connectFromFile(env.mcpServersFile);

  const { agent, toolCount } = await buildAgent({
    env,
    memory,
    mcpManager,
  });

  console.log(
    `[Model Proxy] enabled=${proxyStatus.enabled}, ${proxyStatus.proxyUrl ? `url=${proxyStatus.proxyUrl}, ` : ""}status=${proxyStatus.message}`
  );

  console.log(
    `[Check Design Ready] thread=${args.threadId}, tools=${toolCount}, mcpServers=${mcpManager.connectedServerCount()}, milvusAvailable=${memory.isAvailable()}, milvusTimeoutMs=${memory.timeoutMs()}`
  );

  try {
    const basePromptInput = {
      design: args.design,
      url: args.url,
      viewport: args.viewport,
      extra: args.extra,
    };

    const prompt = await renderCheckDesignPrompt(basePromptInput);

    let output = "";
    try {
      const result = (await agent.invoke(
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
            thread_id: args.threadId,
          },
          recursionLimit: CHECK_DESIGN_RECURSION_LIMIT,
        }
      )) as { messages?: BaseMessage[] };

      const report = extractLatestAIText(result.messages ?? []);
      const normalizedReport = report.trim();
      if (normalizedReport === "") {
        output = "（模型未返回文本）";
      } else if (/model call limits exceeded/i.test(normalizedReport)) {
        output = await renderModelLimitBlockedReport({
          ...basePromptInput,
          detail: normalizedReport,
        });
      } else {
        output = normalizedReport;
      }
    } catch (error) {
      if (!isGraphRecursionError(error)) {
        throw error;
      }
      output = await renderRecursionBlockedReport({
        ...basePromptInput,
        recursionLimit: CHECK_DESIGN_RECURSION_LIMIT,
        detail: error instanceof Error ? error.message : String(error),
      });
      console.warn(
        `[CheckDesign] 触发递归上限，已降级输出阻塞报告（recursionLimit=${CHECK_DESIGN_RECURSION_LIMIT}）。`
      );
    }

    console.log(`\n${output}`);

    if (args.outPath) {
      const absolutePath = path.isAbsolute(args.outPath)
        ? args.outPath
        : path.resolve(process.cwd(), args.outPath);
      await writeFile(absolutePath, output, "utf8");
      console.log(`\n[Saved] ${absolutePath}`);
    }
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