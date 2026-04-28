import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { tool } from "langchain";
import { z } from "zod";

import { loadAndSplitTextDocuments } from "../utils/documentChunker.js";

const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const McpServerConfigListSchema = z.array(McpServerConfigSchema);

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

type ConnectedServer = {
  name: string;
  client: Client;
  transport: StdioClientTransport;
};

const MCP_TOOL_CHUNK_SIZE = 1800;
const MCP_TOOL_CHUNK_OVERLAP = 180;
const MCP_TOOL_MAX_RETURN_CHUNKS = 10;
const MCP_TOOL_CHUNK_TRIGGER_LENGTH = 24000;

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function compactMcpToolOutput(output: string): Promise<string> {
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= MCP_TOOL_CHUNK_TRIGGER_LENGTH) {
    return trimmed;
  }

  const chunks = await loadAndSplitTextDocuments({
    text: trimmed,
    source: "mcp_tool_output",
    chunkSize: MCP_TOOL_CHUNK_SIZE,
    chunkOverlap: MCP_TOOL_CHUNK_OVERLAP,
  });

  const selectedChunks = chunks.slice(0, MCP_TOOL_MAX_RETURN_CHUNKS);
  const lines = selectedChunks.map((doc, index) => {
    const chunkIndex = Number(doc.metadata.chunkIndex ?? index);
    const chunkCount = Number(doc.metadata.chunkCount ?? chunks.length);
    return [
      `[chunk ${chunkIndex + 1}/${chunkCount}]`,
      doc.pageContent,
    ].join("\n");
  });

  return [
    `[MCP output is very large; showing ${selectedChunks.length}/${chunks.length} chunks. ` +
      `Refine your next tool call to fetch a narrower scope if needed.]`,
    ...lines,
  ].join("\n\n");
}

async function normalizeMcpResult(result: unknown): Promise<string> {
  if (!result || typeof result !== "object") {
    return compactMcpToolOutput(String(result ?? ""));
  }

  if ("toolResult" in result) {
    return compactMcpToolOutput(safeJSONStringify(result.toolResult));
  }

  const typed = result as {
    content?: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
  };

  const lines: string[] = [];
  for (const block of typed.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      lines.push(block.text);
      continue;
    }
    if (block.type === "resource" && typeof block.resource === "object") {
      const resource = block.resource as { uri?: string; text?: string };
      if (resource.text) {
        lines.push(resource.text);
      } else if (resource.uri) {
        lines.push(`[resource] ${resource.uri}`);
      }
      continue;
    }
    if (block.type === "resource_link" && typeof block.uri === "string") {
      lines.push(`[resource_link] ${block.uri}`);
      continue;
    }
    if (block.type === "image" && typeof block.mimeType === "string") {
      lines.push(`[image] ${block.mimeType}`);
      continue;
    }
    lines.push(safeJSONStringify(block));
  }

  if (typed.structuredContent !== undefined) {
    lines.push(`structuredContent: ${safeJSONStringify(typed.structuredContent)}`);
  }

  const output = lines.join("\n").trim();
  if (!output) {
    return "MCP tool executed successfully (empty output).";
  }

  const compacted = await compactMcpToolOutput(output);

  if (typed.isError) {
    throw new Error(compacted);
  }
  return compacted;
}

export class McpManager {
  private readonly servers: ConnectedServer[] = [];
  private readonly toolSchema = z.object({}).passthrough();

  async connectFromFile(filePath: string): Promise<void> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    let parsedConfig: unknown;
    try {
      const raw = await readFile(absolutePath, "utf8");
      parsedConfig = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return;
      }
      throw new Error(`Failed to read MCP config file: ${message}`);
    }

    const configs = McpServerConfigListSchema.parse(parsedConfig);
    for (const config of configs) {
      await this.connectOne(config);
    }
  }

  private async connectOne(config: McpServerConfig): Promise<void> {
    const client = new Client(
      {
        name: `ts-agent-${config.name}`,
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      stderr: "inherit",
    });

    await client.connect(transport);
    this.servers.push({ name: config.name, client, transport });
  }

  async getLangChainTools() {
    const wrappedTools = [];

    for (const server of this.servers) {
      const toolsResponse = await server.client.listTools();
      for (const mcpTool of toolsResponse.tools) {
        const wrapped = tool(
          async (input) => {
            const result = await server.client.callTool({
              name: mcpTool.name,
              arguments: input,
            });
            return normalizeMcpResult(result);
          },
          {
            name: `mcp_${server.name}_${mcpTool.name}`.replace(
              /[^a-zA-Z0-9_]/g,
              "_"
            ),
            description:
              `${mcpTool.description ?? "MCP tool"} ` +
              `(source: ${server.name}/${mcpTool.name}, inputSchema: ${safeJSONStringify(
                mcpTool.inputSchema
              )})`,
            schema: this.toolSchema,
          }
        );
        wrappedTools.push(wrapped);
      }
    }

    return wrappedTools;
  }

  connectedServerCount(): number {
    return this.servers.length;
  }

  async closeAll(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.transport.close();
      } catch {
        // Ignore close failures during shutdown.
      }
    }
  }
}
