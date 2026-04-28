import "dotenv/config";

import { z } from "zod";

const RawEnvSchema = z.object({
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().optional(),
  MODEL_PROXY_URL: z.string().optional(),
  MODEL_PROXY_ENABLED: z.string().optional(),
  MILVUS_URL: z.string().optional(),
  MILVUS_COLLECTION: z.string().optional(),
  MILVUS_USERNAME: z.string().optional(),
  MILVUS_PASSWORD: z.string().optional(),
  MILVUS_SSL: z.string().optional(),
  MILVUS_OPERATION_TIMEOUT_MS: z.string().optional(),
  MCP_SERVERS_FILE: z.string().optional(),
});

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export type AgentEnv = {
  googleApiKey: string;
  geminiModel: string;
  geminiEmbeddingModel: string;
  modelProxyUrl?: string;
  modelProxyEnabled: boolean;
  milvusUrl: string;
  milvusCollection: string;
  milvusUsername: string;
  milvusPassword: string;
  milvusSsl: boolean;
  milvusOperationTimeoutMs: number;
  mcpServersFile: string;
};

export function resolveEnv(): AgentEnv {
  const raw = RawEnvSchema.parse(process.env);

  if (!raw.GOOGLE_API_KEY || raw.GOOGLE_API_KEY.trim() === "") {
    throw new Error("GOOGLE_API_KEY is required.");
  }

  return {
    googleApiKey: raw.GOOGLE_API_KEY,
    geminiModel: raw.GEMINI_MODEL?.trim() || "gemini-3-pro-preview",
    geminiEmbeddingModel:
      raw.GEMINI_EMBEDDING_MODEL?.trim() || "text-embedding-004",
    modelProxyUrl: raw.MODEL_PROXY_URL?.trim() || undefined,
    modelProxyEnabled: parseBoolean(raw.MODEL_PROXY_ENABLED, true),
    milvusUrl: raw.MILVUS_URL?.trim() || "http://127.0.0.1:19530",
    milvusCollection: raw.MILVUS_COLLECTION?.trim() || "agent_memory_gemini",
    milvusUsername: raw.MILVUS_USERNAME?.trim() || "",
    milvusPassword: raw.MILVUS_PASSWORD?.trim() || "",
    milvusSsl: parseBoolean(raw.MILVUS_SSL, false),
    milvusOperationTimeoutMs: parsePositiveInt(
      raw.MILVUS_OPERATION_TIMEOUT_MS,
      1200
    ),
    mcpServersFile: raw.MCP_SERVERS_FILE?.trim() || "./mcp.servers.json",
  };
}
