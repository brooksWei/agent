"use client";

import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function createThreadId(prefix: string): string {
  const hasCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
  const suffix = hasCrypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${prefix}-${suffix}`;
}

export default function HomePage() {
  const initialThreadId = useMemo(() => createThreadId("web"), []);
  const initialCheckDesignThread = useMemo(
    () => createThreadId("web-check-design"),
    []
  );

  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");

  const [design, setDesign] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [viewport, setViewport] = useState("1440x900");
  const [extra, setExtra] = useState("");
  const [checkThreadId, setCheckThreadId] = useState(initialCheckDesignThread);
  const [checkPending, setCheckPending] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkOutput, setCheckOutput] = useState("");

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = inputText.trim();
    if (!text || chatPending) {
      return;
    }

    setChatPending(true);
    setChatError("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInputText("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, threadId }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        reply?: string;
        threadId?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "请求失败");
      }

      setThreadId(data.threadId || threadId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply || "（模型未返回文本）" },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatError(message);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `请求失败：${message}` },
      ]);
    } finally {
      setChatPending(false);
    }
  }

  async function handleCheckDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!design.trim() || !pageUrl.trim() || checkPending) {
      return;
    }

    setCheckPending(true);
    setCheckError("");
    setCheckOutput("");

    try {
      const response = await fetch("/api/check-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          design: design.trim(),
          url: pageUrl.trim(),
          viewport: viewport.trim() || "1440x900",
          extra: extra.trim() || undefined,
          threadId: checkThreadId,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        threadId?: string;
        output?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "请求失败");
      }

      setCheckThreadId(data.threadId || checkThreadId);
      setCheckOutput(data.output || "（模型未返回文本）");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCheckError(message);
      setCheckOutput(`请求失败：${message}`);
    } finally {
      setCheckPending(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>全栈 Agent 工作台</h1>
        <p>LangChain + MCP + Milvus + Memory + Next.js + React + TypeScript</p>
      </section>

      <section className="panel">
        <h2>对话 Agent</h2>
        <label>
          Thread ID
          <input
            value={threadId}
            onChange={(event) => setThreadId(event.target.value)}
            placeholder="thread-id"
          />
        </label>
        <div className="messages">
          {messages.length === 0 ? (
            <p className="hint">还没有消息，先问点什么吧。</p>
          ) : (
            messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={message.role}>
                <strong>{message.role === "user" ? "你" : "Agent"}：</strong>
                <span>{message.content}</span>
              </article>
            ))
          )}
        </div>
        <form onSubmit={handleChatSubmit} className="form">
          <textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="输入你的问题..."
            rows={3}
          />
          <button type="submit" disabled={chatPending}>
            {chatPending ? "发送中..." : "发送"}
          </button>
        </form>
        {chatError ? <p className="error">错误：{chatError}</p> : null}
      </section>

      <section className="panel">
        <h2>设计对齐检查</h2>
        <form onSubmit={handleCheckDesign} className="form">
          <label>
            设计链接（MasterGo）
            <input
              value={design}
              onChange={(event) => setDesign(event.target.value)}
              placeholder="https://mastergo.com/file/..."
            />
          </label>
          <label>
            页面 URL
            <input
              value={pageUrl}
              onChange={(event) => setPageUrl(event.target.value)}
              placeholder="http://localhost:5173/..."
            />
          </label>
          <label>
            视口
            <input
              value={viewport}
              onChange={(event) => setViewport(event.target.value)}
              placeholder="1440x900"
            />
          </label>
          <label>
            额外说明（可选）
            <textarea
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
              rows={2}
              placeholder="例如：优先检查顶部导航和首屏表单"
            />
          </label>
          <label>
            Thread ID
            <input
              value={checkThreadId}
              onChange={(event) => setCheckThreadId(event.target.value)}
              placeholder="check-design-thread-id"
            />
          </label>
          <button type="submit" disabled={checkPending}>
            {checkPending ? "检查中..." : "开始检查"}
          </button>
        </form>
        {checkError ? <p className="error">错误：{checkError}</p> : null}
        {checkOutput ? (
          <pre className="report">{checkOutput}</pre>
        ) : (
          <p className="hint">检查结果会显示在这里。</p>
        )}
      </section>
    </main>
  );
}
