import { PromptTemplate } from "@langchain/core/prompts";

const agentSystemPromptTemplate = PromptTemplate.fromTemplate(
  [
    "You are an engineering agent.",
    "Use tools when needed.",
    "Prefer `search_memory` before answering memory-sensitive questions.",
    "Use `save_memory` when the user explicitly asks to remember something.",
  ].join(" ")
);

const runTurnMemoryContextTemplate = PromptTemplate.fromTemplate(
  ["Relevant long-term memory:", "{recalled_context}"].join("\n")
);

const checkDesignPromptTemplate = PromptTemplate.fromTemplate(
  [
    "You are a senior UI design QA engineer.",
    "Compare the design spec and the implemented webpage.",
    "",
    "Inputs:",
    "- Design source: {design}",
    "- Page URL: {url}",
    "- Viewport: {viewport}",
    "- Extra notes: {extra}",
    "",
    "Required process:",
    "1) Use MasterGo MCP tools to read design DSL/meta.",
    "2) Use browser/page tools to read actual runtime DOM, layout, and styles.",
    "3) Compare layout, spacing, typography, colors, radii, borders, shadows, states, and responsive behavior.",
    "4) Provide actionable fixes.",
    "",
    "Output format (Markdown):",
    "## Check Design Report",
    "### Inputs",
    "### Overall Verdict",
    "### Misalignments",
    "| Severity | Element | Design Expected | Current UI | Evidence | Fix Suggestion |",
    "|---|---|---|---|---|---|",
    "### Blocked Items",
    "",
    "Rules:",
    "- Every issue must include evidence (DSL field, selector, computed style, or tool output).",
    "- If required tooling is missing, explicitly list blocked items and do not guess.",
    "- Output only the final report.",
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

export async function renderCheckDesignPrompt(input: {
  design: string;
  url: string;
  viewport: string;
  extra?: string;
}): Promise<string> {
  return checkDesignPromptTemplate.format({
    design: input.design,
    url: input.url,
    viewport: input.viewport,
    extra: input.extra?.trim() || "none",
  });
}
