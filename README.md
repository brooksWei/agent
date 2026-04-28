# 全栈 Agent 框架（Next.js + React + TypeScript）

基于 `LangChain + Tool + MCP + Milvus + Memory`，当前聚焦 **设计对齐检查** 场景，支持 `Gemini / DeepSeek` 自由切换。

## 核心能力

- Web 前端：Next.js App Router + React
- 服务端 Agent：LangChain `createAgent`
- 模型可选：Gemini、DeepSeek（支持每次请求单独配置）
- MCP 工具接入：MasterGo / Playwright / Filesystem
- 长期记忆：Milvus（非阻塞降级）

## 目录结构

```txt
app/
  api/check-design/route.ts   # 设计对齐检查 API
  layout.tsx
  page.tsx                    # 设计检查工作台（含模型配置）

src/
  agent/buildAgent.ts
  server/agentRuntime.ts
  checkDesign.ts              # CLI 设计检查
  mcp/mcpManager.ts
  memory/milvusMemory.ts
  prompts/templates.ts
```

## 安装与启动

```bash
npm install --legacy-peer-deps
npm run dev
```

生产构建：

```bash
npm run build
npm run start
```

## 环境变量

复制模板：

```bash
cp .env.example .env
```

关键变量：

```env
MODEL_PROVIDER=deepseek

GOOGLE_API_KEY=your_google_api_key
GEMINI_MODEL=gemini-3-pro-preview
GEMINI_EMBEDDING_MODEL=text-embedding-004

DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

说明：

- `MODEL_PROVIDER` 只是默认值，Web/API/CLI 都可以单次覆盖。
- 若只使用 DeepSeek，可不填 `GOOGLE_API_KEY`，但 Milvus Memory 会自动降级不可用（因为当前 embedding 走 Gemini）。

## check-design（CLI）

默认命令（已预置参数）：

```bash
npm run check-design
```

通用命令：

```bash
npm run check-design:cli -- --design "https://mastergo.com/file/..." --url "http://localhost:5173/..." --out "./check-design/check-design.md"
```

模型覆盖参数：

```bash
--provider gemini|deepseek
--model <model_name>
--api-key <api_key>
--base-url <url>          # 主要给 deepseek
--temperature <0..2>
```

示例：

```bash
npm run check-design:cli -- --design "https://mastergo.com/file/..." --url "http://localhost:5173/..." --provider deepseek --model deepseek-v4-pro --temperature 0.2
```

## API

### `POST /api/check-design`

请求示例：

```json
{
  "design": "https://mastergo.com/file/...",
  "url": "http://localhost:5173/edit?id=xxx",
  "viewport": "1440x900",
  "threadId": "check-design-thread-1",
  "extra": "优先检查首屏区域",
  "modelConfig": {
    "provider": "deepseek",
    "model": "deepseek-v4-pro",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.deepseek.com",
    "temperature": 0.2
  }
}
```

返回示例：

```json
{
  "ok": true,
  "threadId": "check-design-thread-1",
  "output": "## 设计对齐检查报告 ...",
  "meta": {
    "model": {
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "baseUrl": "https://api.deepseek.com"
    }
  }
}
```
