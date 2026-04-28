# 全栈 Agent 框架（Next.js + React + TypeScript）

基于 `LangChain + Tool + MCP + Milvus + Memory`，升级为 `Next.js + React + TypeScript` 全栈架构。

## 核心能力

- Web 前端：Next.js App Router + React
- 服务端 Agent：LangChain `createAgent`
- MCP 工具接入：支持 MasterGo、Playwright、Filesystem 等
- 长期记忆：Milvus（非阻塞降级）
- 短期记忆：LangGraph `MemorySaver`（按 `thread_id`）
- 内置 Memory 工具：`save_memory` / `search_memory`

## 目录结构

```txt
app/
  api/chat/route.ts           # 聊天 API
  api/check-design/route.ts   # 设计对齐检查 API
  layout.tsx
  page.tsx                    # Web 工作台

src/
  agent/buildAgent.ts
  server/agentRuntime.ts      # 统一运行时（CLI + API 复用）
  checkDesign.ts              # CLI 设计检查
  main.ts                     # CLI 聊天
  mcp/mcpManager.ts
  memory/milvusMemory.ts
  prompts/templates.ts
```

## 环境准备

1. Node.js >= 20（推荐 22+）
2. 可访问的 Gemini API Key
3. 可选：Milvus 服务
4. 可选：MCP servers

安装依赖：

```bash
npm install --legacy-peer-deps
```

## 环境变量

复制模板：

```bash
cp .env.example .env
```

关键项：

```env
GOOGLE_API_KEY=your_google_api_key
GEMINI_MODEL=gemini-3-pro-preview
GEMINI_EMBEDDING_MODEL=text-embedding-004

MODEL_PROXY_ENABLED=true
MODEL_PROXY_URL=http://127.0.0.1:7890

MILVUS_URL=http://127.0.0.1:19530
MILVUS_COLLECTION=agent_memory_gemini
MILVUS_OPERATION_TIMEOUT_MS=1200

MCP_SERVERS_FILE=./mcp.servers.json
```

## MCP 配置

复制示例：

```bash
cp mcp.servers.example.json mcp.servers.json
```

示例包含：

- `filesystem`
- `mastergo_magic_mcp`
- `playwright_mcp`

## 启动方式

Web 开发：

```bash
npm run dev
```

生产构建：

```bash
npm run build
npm run start
```

CLI 聊天（兼容）：

```bash
npm run cli:chat
npm run cli:chat -- --thread demo "你好"
```

CLI 设计检查（兼容）：

```bash
npm run check-design:cli -- --design "https://mastergo.com/file/..." --url "http://localhost:5173/..."
```

默认检查命令（已预置参数）：

```bash
npm run check-design
```

输出报告建议目录：`check-design/check-design.md`

## API 说明

### `POST /api/chat`

请求：

```json
{
  "message": "你好",
  "threadId": "web-thread-1"
}
```

返回：

```json
{
  "ok": true,
  "threadId": "web-thread-1",
  "reply": "你好，有什么我可以帮你的？"
}
```

### `POST /api/check-design`

请求：

```json
{
  "design": "https://mastergo.com/file/...",
  "url": "http://localhost:5173/edit?id=xxx",
  "viewport": "1440x900",
  "threadId": "check-design-thread-1",
  "extra": "优先检查首屏区域"
}
```

返回：

```json
{
  "ok": true,
  "threadId": "check-design-thread-1",
  "output": "## 设计对齐检查报告 ..."
}
```

## 注意事项

- Milvus 不可达时会自动降级为非阻塞模式，主流程不会被阻塞。
- 若网络访问国外模型受限，请开启 `MODEL_PROXY_URL`。
- `mcp.servers.json` 已在 `.gitignore` 中，建议将 token 放在本地文件或环境变量中。
