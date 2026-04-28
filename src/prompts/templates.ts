import { PromptTemplate } from "@langchain/core/prompts";

export type CheckDesignPromptInput = {
  design: string;
  url: string;
  viewport: string;
  extra?: string;
};

type RecursionBlockedReportInput = CheckDesignPromptInput & {
  recursionLimit: number;
  detail: string;
};

type ModelLimitBlockedReportInput = CheckDesignPromptInput & {
  detail: string;
};

function normalizeExtra(extra?: string): string {
  const normalized = extra?.trim();
  return normalized && normalized !== "" ? normalized : "无";
}

const agentSystemPromptTemplate = PromptTemplate.fromTemplate(
  [
    "你是一个工程助手。",
    "默认使用中文回复，除非用户明确要求其他语言。",
    "需要时调用工具完成任务。",
    "涉及长期记忆的问题，优先调用 `search_memory`。",
    "只有在用户明确要求“记住某事”时才调用 `save_memory`。",
  ].join(" ")
);

const runTurnMemoryContextTemplate = PromptTemplate.fromTemplate(
  ["相关长期记忆：", "{recalled_context}"].join("\n")
);

const checkDesignPromptTemplate = PromptTemplate.fromTemplate(
  [
    "你是一名资深 UI 设计走查工程师。",
    "请对比设计稿与网页实现，并输出可执行修复建议。",
    "",
    "输入：",
    "- 设计来源: {design}",
    "- 页面 URL: {url}",
    "- 视口: {viewport}",
    "- 额外说明: {extra}",
    "",
    "必做流程：",
    "1) 使用 MasterGo MCP 工具读取设计 DSL 或元数据。",
    "2) 使用浏览器/页面工具读取真实运行态 DOM、布局与样式。",
    "3) 对比布局、间距、字体、颜色、圆角、边框、阴影、状态与响应式表现。",
    "4) 输出可执行修复建议。",
    "",
    "停止条件（必须遵守）：",
    "- 证据充分后立刻停止继续调用工具，并直接输出最终报告。",
    "- 若多次调用工具仍无法推进，直接在“阻塞项”中说明并结束。",
    "- 达到工具或模型调用上限时，立刻输出当前结论，不要继续调用工具。",
    "",
    "输出格式（Markdown，必须中文）：",
    "## 设计对齐检查报告",
    "### 输入",
    "### 总体结论",
    "### 不对齐项",
    "| 严重级别 | 元素 | 设计期望 | 当前实现 | 证据 | 修复建议 |",
    "|---|---|---|---|---|---|",
    "### 阻塞项",
    "",
    "规则：",
    "- 每个问题必须给出证据（DSL 字段、选择器、计算样式或工具输出）。",
    "- 缺少必要工具时必须明确写入“阻塞项”，禁止猜测。",
    "- 只输出最终报告，不输出思考过程。",
  ].join("\n")
);

const recursionBlockedReportTemplate = PromptTemplate.fromTemplate(
  [
    "## 设计对齐检查报告",
    "### 输入",
    "- 设计来源: {design}",
    "- 页面 URL: {url}",
    "- 视口: {viewport}",
    "- 额外说明: {extra}",
    "",
    "### 总体结论",
    "本次检查在代理工具循环阶段中止：达到递归上限（recursionLimit={recursion_limit}）。",
    "",
    "### 不对齐项",
    "| 严重级别 | 元素 | 设计期望 | 当前实现 | 证据 | 修复建议 |",
    "|---|---|---|---|---|---|",
    "| - | - | - | - | - | - |",
    "",
    "### 阻塞项",
    "- 触发 GraphRecursionError：{detail}",
    "- 建议缩小检查范围（例如指定页面模块或组件）后重试。",
    "- 建议收敛工具调用路径，避免长链路循环。",
  ].join("\n")
);

const modelLimitBlockedReportTemplate = PromptTemplate.fromTemplate(
  [
    "## 设计对齐检查报告",
    "### 输入",
    "- 设计来源: {design}",
    "- 页面 URL: {url}",
    "- 视口: {viewport}",
    "- 额外说明: {extra}",
    "",
    "### 总体结论",
    "本次检查因模型调用上限触发而提前结束，未完成全部对比步骤。",
    "",
    "### 不对齐项",
    "| 严重级别 | 元素 | 设计期望 | 当前实现 | 证据 | 修复建议 |",
    "|---|---|---|---|---|---|",
    "| - | - | - | - | - | - |",
    "",
    "### 阻塞项",
    "- 触发模型调用上限：{detail}",
    "- 建议缩小检查范围（例如只检查一个模块）后重试。",
    "- 建议进一步收敛工具返回内容，减少无效循环。",
  ].join("\n")
);

export async function renderAgentSystemPrompt(): Promise<string> {
  return agentSystemPromptTemplate.format({});
}

export async function renderRunTurnMemoryContextPrompt(
  recalledContext: string
): Promise<string> {
  return runTurnMemoryContextTemplate.format({
    recalled_context: recalledContext,
  });
}

export async function renderCheckDesignPrompt(
  input: CheckDesignPromptInput
): Promise<string> {
  return checkDesignPromptTemplate.format({
    design: input.design,
    url: input.url,
    viewport: input.viewport,
    extra: normalizeExtra(input.extra),
  });
}

export async function renderRecursionBlockedReport(
  input: RecursionBlockedReportInput
): Promise<string> {
  return recursionBlockedReportTemplate.format({
    design: input.design,
    url: input.url,
    viewport: input.viewport,
    extra: normalizeExtra(input.extra),
    recursion_limit: String(input.recursionLimit),
    detail: input.detail,
  });
}

export async function renderModelLimitBlockedReport(
  input: ModelLimitBlockedReportInput
): Promise<string> {
  return modelLimitBlockedReportTemplate.format({
    design: input.design,
    url: input.url,
    viewport: input.viewport,
    extra: normalizeExtra(input.extra),
    detail: input.detail,
  });
}
