import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { BaseMessage } from "@langchain/core/messages";

import { buildAgent } from "./agent/buildAgent.js";
import { resolveEnv } from "./config/env.js";
import { McpManager } from "./mcp/mcpManager.js";
import { MilvusMemory } from "./memory/milvusMemory.js";
import { extractLatestAIText } from "./utils/message.js";

type CheckDesignArgs = {
  design: string;
  url: string;
  threadId: string;
  viewport: string;
  outPath?: string;
  extra?: string;
};

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

function buildCheckDesignPrompt(args: CheckDesignArgs): string {
  return [
    "你是资深设计走查工程师，请对“设计稿 vs 页面实现”做严谨对比。",
    "",
    "必须执行的步骤：",
    `1) 使用 MasterGo MCP 工具读取设计稿：${args.design}`,
    `2) 使用可用的页面/浏览器工具读取页面：${args.url}`,
    "3) 对齐检查范围：布局、尺寸、间距、字体、颜色、圆角、阴影、边框、层级、组件状态、响应式。",
    "4) 给出可执行修复建议。",
    "",
    "输出格式（Markdown）：",
    "## Check Design Report",
    "### Inputs",
    "### Overall Verdict",
    "### Misalignments",
    "| Severity | Element | Design Expected | Current UI | Evidence | Fix Suggestion |",
    "|---|---|---|---|---|---|",
    "### Blocked Items",
    "",
    "要求：",
    "- 每个问题必须有证据（DSL字段、页面样式值、选择器或工具输出）。",
    "- 如果缺少必要工具（例如页面抓取工具），请明确指出缺失项并停止臆测。",
    "- 只输出最终报告，不输出思考过程。",
    "",
    `约束：viewport=${args.viewport}`,
    `补充要求：${args.extra?.trim() || "无"}`,
  ].join("\n");
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
  const memory = await MilvusMemory.create(env);
  const mcpManager = new McpManager();
  await mcpManager.connectFromFile(env.mcpServersFile);

  const { agent, toolCount } = await buildAgent({
    env,
    memory,
    mcpManager,
  });

  console.log(
    `[Check Design Ready] thread=${args.threadId}, tools=${toolCount}, mcpServers=${mcpManager.connectedServerCount()}, milvusAvailable=${memory.isAvailable()}, milvusTimeoutMs=${memory.timeoutMs()}`
  );

  try {
    const prompt = buildCheckDesignPrompt(args);
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
      }
    )) as { messages?: BaseMessage[] };

    const report = extractLatestAIText(result.messages ?? []);
    const output = report || "(No text response returned.)";
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
