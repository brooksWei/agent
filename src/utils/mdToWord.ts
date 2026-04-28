import { marked } from "marked";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function markdownToHtml(markdown: string): Promise<string> {
  const safeMarkdown = escapeHtml(markdown ?? "");
  const rendered = await marked.parse(safeMarkdown, {
    gfm: true,
    breaks: true,
  });
  return typeof rendered === "string" ? rendered : String(rendered);
}

export async function renderReportAsWordHtml(
  markdown: string,
  title = "设计对齐检查报告"
): Promise<string> {
  const html = await markdownToHtml(markdown);
  return [
    `<h1>${escapeHtml(title)}</h1>`,
    '<div class="word-body">',
    html,
    "</div>",
  ].join("\n");
}

export async function mdToWord(markdown: string, title?: string): Promise<Blob> {
  const html = await markdownToHtml(markdown);
  const htmlWithTitle = title ? `<h1>${escapeHtml(title)}</h1>${html}` : html;
  const wordHtml = [
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" />",
    "</head>",
    "<body>",
    htmlWithTitle,
    "</body>",
    "</html>",
  ].join("");

  return new Blob([wordHtml], {
    type: "application/msword;charset=utf-8",
  });
}

export function downloadWord(blob: Blob, filename = "document.docx"): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportReportAsWord(
  reportText: string,
  filename = "check-report.docx"
): Promise<void> {
  const docx = await mdToWord(reportText, "设计对齐检查报告");
  downloadWord(docx, filename);
}
