import type { BaseMessage } from "@langchain/core/messages";

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          (block as { type?: string }).type === "text" &&
          "text" in block
        ) {
          return String((block as { text: unknown }).text);
        }
        try {
          return JSON.stringify(block);
        } catch {
          return String(block);
        }
      })
      .join("\n");
  }

  if (content && typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  return String(content ?? "");
}

export function extractLatestAIText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.getType() === "ai") {
      return contentToText(message.content);
    }
  }
  return "";
}
