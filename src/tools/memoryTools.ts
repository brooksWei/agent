import { tool } from "langchain";
import { z } from "zod";

import type { MilvusMemory } from "../memory/milvusMemory";

export function createMemoryTools(memory: MilvusMemory) {
  const saveMemory = tool(
    async ({ content, thread_id, role, source }) => {
      const id = await memory.addMemory({
        threadId: thread_id || "default",
        role: role || "note",
        source: source || "tool",
        content,
      });
      return `Memory saved: ${id}`;
    },
    {
      name: "save_memory",
      description: "Save a long-term memory entry into Milvus.",
      schema: z.object({
        content: z.string().min(1).describe("Memory content."),
        thread_id: z
          .string()
          .optional()
          .describe("Conversation thread id. Defaults to 'default'."),
        role: z
          .string()
          .optional()
          .describe("Role label like user/assistant/note."),
        source: z.string().optional().describe("Data source label."),
      }),
    }
  );

  const searchMemory = tool(
    async ({ query, thread_id, top_k }) => {
      const hits = await memory.searchMemory({
        query,
        threadId: thread_id,
        topK: top_k || 4,
      });
      if (hits.length === 0) {
        return "No memory found.";
      }
      return JSON.stringify(hits, null, 2);
    },
    {
      name: "search_memory",
      description: "Search long-term memory in Milvus by semantic similarity.",
      schema: z.object({
        query: z.string().min(1).describe("Search query."),
        thread_id: z
          .string()
          .optional()
          .describe("Filter by thread id if provided."),
        top_k: z.number().int().min(1).max(20).optional().default(4),
      }),
    }
  );

  return [saveMemory, searchMemory];
}
