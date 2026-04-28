"use client";

import { FormEvent, useMemo, useState } from "react";

type ModelProvider = "gemini" | "deepseek";

function createThreadId(prefix: string): string {
  const hasCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
  const suffix = hasCrypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${prefix}-${suffix}`;
}

export default function HomePage() {
  const initialCheckDesignThread = useMemo(
    () => createThreadId("web-check-design"),
    []
  );

  const [design, setDesign] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [viewport, setViewport] = useState("1920x1080");
  const [extra, setExtra] = useState("");
  const [checkThreadId, setCheckThreadId] = useState(initialCheckDesignThread);
  const [checkPending, setCheckPending] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkOutput, setCheckOutput] = useState("");

  const [provider, setProvider] = useState<ModelProvider>("deepseek");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.2");
  const [runtimeModelInfo, setRuntimeModelInfo] = useState("");

  async function handleCheckDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!design.trim() || !pageUrl.trim() || checkPending) {
      return;
    }

    setCheckPending(true);
    setCheckError("");
    setCheckOutput("");

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

    try {
      const response = await fetch("/api/check-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          design: design.trim(),
          url: pageUrl.trim(),
          viewport: viewport.trim() || "1920x1080",
          extra: extra.trim() || undefined,
          threadId: checkThreadId,
          modelConfig,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        threadId?: string;
        output?: string;
        error?: string;
        meta?: {
          model?: {
            provider?: string;
            model?: string;
            baseUrl?: string;
          };
        };
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "请求失败");
      }

      const modelMeta = data.meta?.model;
      if (modelMeta?.provider && modelMeta?.model) {
        const base = modelMeta.baseUrl ? ` | ${modelMeta.baseUrl}` : "";
        setRuntimeModelInfo(`${modelMeta.provider} / ${modelMeta.model}${base}`);
      } else {
        setRuntimeModelInfo("");
      }

      setCheckThreadId(data.threadId || checkThreadId);
      setCheckOutput(data.output || "(No text response returned.)");
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
              placeholder="1920x1080"
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
