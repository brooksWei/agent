import { randomUUID } from "node:crypto";

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
  private constructor(private readonly vectorStore: Milvus) {}

  static async create(env: AgentEnv): Promise<MilvusMemory> {
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: env.googleApiKey,
      model: env.geminiEmbeddingModel,
    });

    let vectorStore: Milvus;
    try {
      vectorStore = await Milvus.fromExistingCollection(embeddings, {
        collectionName: env.milvusCollection,
        url: env.milvusUrl,
        username: env.milvusUsername,
        password: env.milvusPassword,
        ssl: env.milvusSsl,
      });
    } catch {
      vectorStore = new Milvus(embeddings, {
        collectionName: env.milvusCollection,
        url: env.milvusUrl,
        username: env.milvusUsername,
        password: env.milvusPassword,
        ssl: env.milvusSsl,
      });
    }

    return new MilvusMemory(vectorStore);
  }

  async addMemory(input: AddMemoryInput): Promise<string> {
    const id = randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const source = input.source ?? "chat";

    await this.vectorStore.addDocuments([
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
    ]);

    return id;
  }

  async searchMemory(input: SearchMemoryInput): Promise<MemoryItem[]> {
    const topK = input.topK ?? 4;
    const filter = input.threadId
      ? `threadId == "${input.threadId.replace(/"/g, '\\"')}"`
      : undefined;

    try {
      const docsWithScore = await this.vectorStore.similaritySearchWithScore(
        input.query,
        topK,
        filter
      );

      return docsWithScore.map(([doc, score]) => {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Collection not found")) {
        return [];
      }
      throw error;
    }
  }
}
