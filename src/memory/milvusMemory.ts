import { randomUUID } from "node:crypto";
import net from "node:net";

import { Document } from "@langchain/core/documents";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Milvus } from "@langchain/community/vectorstores/milvus";

import type { AgentEnv } from "../config/env.js";

export type MemoryItem = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  source: string;
  createdAt: string;
  score?: number;
};

export type AddMemoryInput = {
  threadId: string;
  role: string;
  content: string;
  source?: string;
  createdAt?: string;
};

export type SearchMemoryInput = {
  query: string;
  threadId?: string;
  topK?: number;
};

export class MilvusMemory {
  private warnedUnavailable = false;

  private constructor(
    private readonly vectorStore: Milvus | null,
    private readonly operationTimeoutMs: number
  ) {}

  private warnUnavailableOnce() {
    if (!this.warnedUnavailable) {
      this.warnedUnavailable = true;
      console.warn(
        "[MilvusMemory] Milvus unavailable. Memory read/write will be skipped."
      );
    }
  }

  private static errorToString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private static parseMilvusAddress(milvusUrl: string): {
    host: string;
    port: number;
  } | null {
    const normalized = /^https?:\/\//i.test(milvusUrl)
      ? milvusUrl
      : `http://${milvusUrl}`;
    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname;
      const port = parsed.port ? Number.parseInt(parsed.port, 10) : 19530;
      if (!host || Number.isNaN(port) || port <= 0) {
        return null;
      }
      return { host, port };
    } catch {
      return null;
    }
  }

  private static canReachMilvus(
    milvusUrl: string,
    timeoutMs: number
  ): Promise<boolean> {
    const address = MilvusMemory.parseMilvusAddress(milvusUrl);
    if (!address) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const settle = (ok: boolean) => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(ok);
        }
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => settle(true));
      socket.once("timeout", () => settle(false));
      socket.once("error", () => settle(false));
      socket.connect(address.port, address.host);
    });
  }

  static async create(env: AgentEnv): Promise<MilvusMemory> {
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: env.googleApiKey,
      model: env.geminiEmbeddingModel,
    });

    const reachable = await MilvusMemory.canReachMilvus(
      env.milvusUrl,
      env.milvusOperationTimeoutMs
    );
    if (!reachable) {
      console.warn(
        `[MilvusMemory] ${env.milvusUrl} is unreachable. Memory disabled in non-blocking mode.`
      );
      return new MilvusMemory(null, env.milvusOperationTimeoutMs);
    }

    try {
      const lazyStore = new Milvus(embeddings, {
        collectionName: env.milvusCollection,
        url: env.milvusUrl,
        username: env.milvusUsername,
        password: env.milvusPassword,
        ssl: env.milvusSsl,
      });
      return new MilvusMemory(lazyStore, env.milvusOperationTimeoutMs);
    } catch (error) {
      console.warn(
        `[MilvusMemory] Lazy client init failed: ${MilvusMemory.errorToString(
          error
        )}. Memory disabled.`
      );
      return new MilvusMemory(null, env.milvusOperationTimeoutMs);
    }
  }

  async addMemory(input: AddMemoryInput): Promise<string> {
    const id = randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const source = input.source ?? "chat";

    if (!this.vectorStore) {
      this.warnUnavailableOnce();
      return id;
    }

    const writeTask = this.vectorStore
      .addDocuments([
        new Document({
          pageContent: input.content,
          metadata: {
            memoryId: id,
            threadId: input.threadId,
            role: input.role,
            source,
            createdAt,
          },
        }),
      ])
      .then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error })
      );

    const writeResult = await Promise.race([
      writeTask,
      new Promise<{ ok: false; timeout: true }>((resolve) => {
        setTimeout(
          () => resolve({ ok: false, timeout: true }),
          this.operationTimeoutMs
        );
      }),
    ]);

    if ("timeout" in writeResult) {
      console.warn(
        `[MilvusMemory] addMemory timed out after ${this.operationTimeoutMs}ms. Skipping without blocking.`
      );
    } else if (!writeResult.ok) {
      console.warn(
        `[MilvusMemory] addMemory failed: ${MilvusMemory.errorToString(
          writeResult.error
        )}`
      );
    }

    return id;
  }

  async searchMemory(input: SearchMemoryInput): Promise<MemoryItem[]> {
    if (!this.vectorStore) {
      this.warnUnavailableOnce();
      return [];
    }

    const topK = input.topK ?? 4;
    const filter = input.threadId
      ? `threadId == "${input.threadId.replace(/"/g, '\\"')}"`
      : undefined;

    const searchTask = this.vectorStore.similaritySearchWithScore(
      input.query,
      topK,
      filter
    );
    const searchResult = await Promise.race([
      searchTask.then(
        (docs) => ({ ok: true as const, docs }),
        (error) => ({ ok: false as const, error })
      ),
      new Promise<{ ok: false; timeout: true }>((resolve) => {
        setTimeout(
          () => resolve({ ok: false, timeout: true }),
          this.operationTimeoutMs
        );
      }),
    ]);

    if ("timeout" in searchResult) {
      console.warn(
        `[MilvusMemory] searchMemory timed out after ${this.operationTimeoutMs}ms. Returning empty result.`
      );
      return [];
    }

    if (!searchResult.ok) {
      const message = MilvusMemory.errorToString(searchResult.error);
      if (message.includes("Collection not found")) {
        return [];
      }
      console.warn(`[MilvusMemory] searchMemory failed: ${message}`);
      return [];
    }

    return searchResult.docs.map(([doc, score]) => {
      const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
      return {
        id: String(metadata.memoryId ?? ""),
        threadId: String(metadata.threadId ?? ""),
        role: String(metadata.role ?? ""),
        source: String(metadata.source ?? ""),
        createdAt: String(metadata.createdAt ?? ""),
        content: doc.pageContent,
        score,
      };
    });
  }

  isAvailable(): boolean {
    return Boolean(this.vectorStore);
  }

  timeoutMs(): number {
    return this.operationTimeoutMs;
  }
}
