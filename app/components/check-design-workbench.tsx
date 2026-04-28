"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { exportReportAsWord, renderReportAsWordHtml } from "../../src/utils/mdToWord";

type ModelProvider = "gemini" | "deepseek";

type ToolCallEvent = {
  index: number;
  threadId: string;
  name: string;
  argsText: string;
  at: string;
};

type StreamMeta = {
  threadId: string;
  model?: {
    provider?: string;
    model?: string;
    baseUrl?: string;
  };
};

type StreamDone = {
  ok: boolean;
  threadId: string;
  output: string;
  recursionLimited: boolean;
  recursionLimit: number;
};

const LONG_ARG_TEXT_LENGTH = 560;
const LONG_ARG_LINE_COUNT = 10;
const DEFAULT_VIEWPORT = "1920x1080";
const CHECK_TIMEOUT_MS = 8 * 60 * 1000;

function createThreadId(prefix: string): string {
  const hasCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
  const suffix = hasCrypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${prefix}-${suffix}`;
}

function isLongToolArgText(content: string): boolean {
  return (
    content.length > LONG_ARG_TEXT_LENGTH ||
    content.split("\n").length > LONG_ARG_LINE_COUNT
  );
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.startsWith("event:")) {
      eventName = rawLine.slice("event:".length).trim();
      continue;
    }
    if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join("\n"),
  };
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function CheckDesignWorkbench() {
  const initialCheckDesignThread = useMemo(
    () => createThreadId("web-check-design"),
    []
  );

  const [design, setDesign] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [extra, setExtra] = useState("");
  const [checkThreadId, setCheckThreadId] = useState(initialCheckDesignThread);
  const [checkPending, setCheckPending] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkOutput, setCheckOutput] = useState("");
  const [wordHtml, setWordHtml] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);

  const [provider, setProvider] = useState<ModelProvider>("deepseek");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.2");
  const [runtimeModelInfo, setRuntimeModelInfo] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const designValue = design.trim();
  const pageUrlValue = pageUrl.trim();
  const canSubmit = !checkPending;

  useEffect(() => {
    let cancelled = false;

    if (!checkOutput.trim()) {
      setWordHtml("");
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const html = await renderReportAsWordHtml(checkOutput);
        if (!cancelled) {
          setWordHtml(html);
        }
      } catch {
        if (!cancelled) {
          setWordHtml("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkOutput]);

  function stopCurrentCheck() {
    abortRef.current?.abort();
  }

  async function startCheck() {
    if (!canSubmit) {
      return;
    }

    if (designValue === "" || pageUrlValue === "") {
      setCheckError("\u8bf7\u5148\u586b\u5199\u8bbe\u8ba1\u94fe\u63a5\u548c\u9875\u9762 URL\u3002");
      return;
    }

    setCheckPending(true);
    setCheckError("");
    setCheckOutput("");
    setToolCalls([]);

    const parsedTemperature = Number(temperature.trim());
    const modelConfig = {
      provider,
      model: modelName.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      temperature:
        Number.isFinite(parsedTemperature) && parsedTemperature >= 0
          ? parsedTemperature
          : undefined,
    };

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => {
      controller.abort(
        new Error(`检查超时（>${Math.floor(CHECK_TIMEOUT_MS / 1000)}秒）`)
      );
    }, CHECK_TIMEOUT_MS);

    let doneReceived = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const response = await fetch("/api/check-design/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        body: JSON.stringify({
          design: designValue,
          url: pageUrlValue,
          viewport: viewport.trim() || DEFAULT_VIEWPORT,
          extra: extra.trim() || undefined,
          threadId: checkThreadId,
          modelConfig,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message =
          (errorBody &&
            typeof errorBody === "object" &&
            "error" in errorBody &&
            typeof errorBody.error === "string" &&
            errorBody.error) ||
          `请求失败: ${response.status}`;
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("当前环境不支持流式响应。");
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const consumeBlocks = () => {
        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary < 0) {
            break;
          }

          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseBlock(block);
          if (!parsed) {
            continue;
          }

          if (parsed.event === "tool_call") {
            const payload = safeJsonParse<ToolCallEvent>(parsed.data);
            if (payload) {
              setToolCalls((prev) => [...prev, payload]);
            }
            continue;
          }

          if (parsed.event === "meta") {
            const payload = safeJsonParse<StreamMeta>(parsed.data);
            const modelMeta = payload?.model;
            if (modelMeta?.provider && modelMeta?.model) {
              const base = modelMeta.baseUrl ? ` | ${modelMeta.baseUrl}` : "";
              setRuntimeModelInfo(
                `${modelMeta.provider} / ${modelMeta.model}${base}`
              );
            } else {
              setRuntimeModelInfo("");
            }
            if (payload?.threadId) {
              setCheckThreadId(payload.threadId);
            }
            continue;
          }

          if (parsed.event === "done") {
            const payload = safeJsonParse<StreamDone>(parsed.data);
            if (payload) {
              doneReceived = true;
              setCheckThreadId(payload.threadId || checkThreadId);
              setCheckOutput(payload.output || "(No text response returned.)");
            }
            continue;
          }

          if (parsed.event === "error") {
            const payload = safeJsonParse<{ error?: string }>(parsed.data);
            throw new Error(payload?.error || "流式请求失败。");
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        consumeBlocks();
      }

      buffer += decoder.decode();
      consumeBlocks();

      if (!doneReceived) {
        throw new Error("流式连接结束，但未收到最终结果。");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = error instanceof Error ? error.message : "已取消当前检查。";
        setCheckError(reason);
        if (!checkOutput.trim()) {
          setCheckOutput("检查已取消。");
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setCheckError(message);
        setCheckOutput(`请求失败：${message}`);
      }
    } finally {
      clearTimeout(timeoutId);
      if (reader) {
        await reader.cancel().catch(() => {});
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setCheckPending(false);
    }
  }

  function handleCheckDesignSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void startCheck();
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>设计对齐检查工作台</h1>
        <p>LangChain + MCP + Milvus + Memory + Next.js + React + TypeScript</p>
      </section>

      <section className="panel">
        <details className="collapse">
          <summary className="collapseSummary">模型配置（可选）</summary>
          <div className="form collapseContent">
            <label>
              Provider
              <select
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as ModelProvider)
                }
              >
                <option value="deepseek">DeepSeek</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
            <label>
              Model（可选，留空走默认）
              <input
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                placeholder={
                  provider === "gemini"
                    ? "gemini-3-pro-preview"
                    : "deepseek-v4-pro"
                }
              />
            </label>
            <label>
              API Key（可选，留空走 .env）
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  provider === "gemini"
                    ? "GOOGLE_API_KEY"
                    : "DEEPSEEK_API_KEY"
                }
              />
            </label>
            {provider === "deepseek" ? (
              <label>
                Base URL（可选，留空走 .env）
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.deepseek.com"
                />
              </label>
            ) : null}
            <label>
              Temperature（0 - 2）
              <input
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
                placeholder="0.2"
              />
            </label>
            {runtimeModelInfo ? (
              <p className="hint">当前请求生效模型：{runtimeModelInfo}</p>
            ) : null}
          </div>
        </details>
      </section>

      <section className="panel">
        <h2>设计对齐检查</h2>
        <form onSubmit={handleCheckDesignSubmit} className="form">
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
              placeholder={DEFAULT_VIEWPORT}
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
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => {
                void startCheck();
              }}
            >
              {checkPending ? "检查中..." : "开始检查"}
            </button>
            {checkPending ? (
              <button type="button" onClick={stopCurrentCheck}>
                停止检查
              </button>
            ) : null}
          </div>
          {!checkPending && (designValue === "" || pageUrlValue === "") ? (
            <p className="hint">请先填写设计链接和页面 URL 后再开始检查。</p>
          ) : null}
        </form>
      </section>

      <section className="panel">
        <h2>Tool Call 流</h2>
        {toolCalls.length === 0 ? (
          <p className="hint">
            {checkPending
              ? "正在等待工具调用..."
              : "开始检查后会在这里实时显示 Tool Call 参数。"}
          </p>
        ) : (
          <div className="toolCallList">
            {toolCalls.map((item) => {
              const longText = isLongToolArgText(item.argsText);
              return (
                <details
                  key={`${item.index}-${item.at}-${item.name}`}
                  className="toolCallItem"
                  open={!longText || undefined}
                >
                  <summary className="toolCallSummary">
                    #{item.index} {item.name} ·{" "}
                    {new Date(item.at).toLocaleTimeString("zh-CN", {
                      hour12: false,
                    })}
                    {longText ? "（参数较长，点击展开）" : ""}
                  </summary>
                  <pre className="toolCallArgs">{item.argsText}</pre>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>检查报告</h2>
        {checkError ? <p className="error">错误：{checkError}</p> : null}
        {checkOutput ? (
          <>
            <div style={{ marginBottom: "10px" }}>
              <button
                type="button"
                onClick={() => {
                  void exportReportAsWord(checkOutput, "check-design-report.docx");
                }}
              >
                导出为 Word
              </button>
            </div>
            {wordHtml ? (
              <article
                className="wordPreview"
                dangerouslySetInnerHTML={{ __html: wordHtml }}
              />
            ) : (
              <pre className="report">{checkOutput}</pre>
            )}
          </>
        ) : (
          <p className="hint">检查结果会显示在这里。</p>
        )}
      </section>
    </main>
  );
}
