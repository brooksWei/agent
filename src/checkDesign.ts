import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  closeRuntime,
  createRuntime,
  getOrCreateCheckDesignThreadId,
  runCheckDesign,
} from "./server/agentRuntime";

type CheckDesignArgs = {
  design: string;
  url: string;
  threadId?: string;
  viewport: string;
  outPath?: string;
  extra?: string;
};

function parseCheckDesignArgs(argv: string[]): CheckDesignArgs {
  let design = "";
  let url = "";
  let threadId: string | undefined;
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
    threadId = positional.shift();
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
      "npm run check-design -- --design \"https://mastergo.com/file/...\" --url \"http://localhost:3000\" --viewport 1440x900 --out ./check-design/check-design.md",
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

  const runtime = await createRuntime();
  const threadId = getOrCreateCheckDesignThreadId(args.threadId);

  console.log(
    `[Model Proxy] enabled=${runtime.proxyStatus.enabled}, ${runtime.proxyStatus.proxyUrl ? `url=${runtime.proxyStatus.proxyUrl}, ` : ""}status=${runtime.proxyStatus.message}`
  );
  console.log(
    `[Check Design Ready] thread=${threadId}, tools=${runtime.toolCount}, mcpServers=${runtime.mcpManager.connectedServerCount()}, milvusAvailable=${runtime.memory.isAvailable()}, milvusTimeoutMs=${runtime.memory.timeoutMs()}`
  );

  try {
    const result = await runCheckDesign(runtime, {
      design: args.design,
      url: args.url,
      viewport: args.viewport,
      extra: args.extra,
      threadId,
    });
    console.log(`\n${result.output}`);

    if (result.recursionLimited) {
      console.warn(
        `[CheckDesign] 触发递归上限，已降级输出阻塞报告（recursionLimit=${result.recursionLimit}）。`
      );
    }

    if (args.outPath) {
      const absolutePath = path.isAbsolute(args.outPath)
        ? args.outPath
        : path.resolve(process.cwd(), args.outPath);
      await writeFile(absolutePath, result.output, "utf8");
      console.log(`\n[Saved] ${absolutePath}`);
    }
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
