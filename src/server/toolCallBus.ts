import { EventEmitter } from "node:events";

export type ToolCallStreamEvent = {
  threadId: string;
  name: string;
  argsText: string;
  at: string;
};

const TOOL_CALL_EVENT_NAME = "tool_call";
const toolCallBus = new EventEmitter();

toolCallBus.setMaxListeners(0);

export function emitToolCallEvent(event: ToolCallStreamEvent): void {
  toolCallBus.emit(TOOL_CALL_EVENT_NAME, event);
}

export function subscribeToolCallEvents(
  threadId: string,
  listener: (event: ToolCallStreamEvent) => void
): () => void {
  const wrappedListener = (event: ToolCallStreamEvent) => {
    if (event.threadId === threadId) {
      listener(event);
    }
  };

  toolCallBus.on(TOOL_CALL_EVENT_NAME, wrappedListener);
  return () => {
    toolCallBus.off(TOOL_CALL_EVENT_NAME, wrappedListener);
  };
}

