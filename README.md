# LangChain Agent Framework (TS)

一个基于 `LangChain + Tool + MCP + Milvus + Memory + TypeScript` 的可运行骨架。

## 特性
- `LangChain createAgent` 作为编排核心
- `MCP` 动态接入外部工具（stdio transport）
- `Milvus` 作为长期记忆向量库
- `MemorySaver` 作为短期会话记忆（thread 级别）
- 内置 memory 工具：`save_memory` / `search_memory`
- 支持单次调用和交互式 CLI

## 目录结构
```txt
src/
  agent/buildAgent.ts         # agent 组装
  config/env.ts               # 环境变量解析
  mcp/mcpManager.ts           # MCP 连接与工具适配
  memory/milvusMemory.ts      # Milvus 长期记忆
  tools/memoryTools.ts        # memory 工具
  utils/message.ts            # 消息解析
  main.ts                     # 入口（CLI）
```

## 环境准备
1. Node.js >= 20（推荐 22+）
2. 可用的 Milvus 实例
3. Google API Key (Gemini)
4. Gemini Embeddings model access (via the same `GOOGLE_API_KEY`)

## 安装
```bash
npm install --legacy-peer-deps
```

## 配置
1. 复制环境变量模板：
```bash
cp .env.example .env
```

2. 按需配置 MCP Server（可选）：
```bash
cp mcp.servers.example.json mcp.servers.json
```

`mcp.servers.json` 示例：
```json
[
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
]
```

## 启动
- 交互式：
```bash
npm run dev
```

- 单次调用：
```bash
npm run dev -- "帮我总结一下这个项目"
```

- 指定 thread id（用于短期记忆上下文）：
```bash
npm run dev -- --thread demo-thread "记住我喜欢 TypeScript"
```

## 构建
```bash
npm run build
npm run start -- --thread prod "你好"
```

## 说明
- 短期记忆：由 `MemorySaver` + `thread_id` 提供
- 长期记忆：通过 `MilvusMemory` 向量检索并在每轮自动回灌上下文
- MCP 工具：启动时读取 `MCP_SERVERS_FILE` 指向的配置并注册为 LangChain 工具

## MasterGo MCP
Add MasterGo MCP server in `mcp.servers.json`:

```json
{
  "name": "mastergo_magic_mcp",
  "command": "npx",
  "args": ["-y", "@mastergo/magic-mcp"],
  "env": {
    "MG_MCP_TOKEN": "YOUR_MASTERGO_TOKEN",
    "API_BASE_URL": "https://mastergo.com"
  }
}
```

Replace `YOUR_MASTERGO_TOKEN` with your real MasterGo token.
