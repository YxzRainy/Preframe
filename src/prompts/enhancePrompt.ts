/** 新三文档流程的依赖关系：只向下游传递唯一真源，避免循环引用和口径漂移。 */
export const DOCUMENT_CONTEXT_FILES = {
  "01": [] as readonly string[],
  "02": ["01_创作简报.md"] as readonly string[],
  "03": ["01_创作简报.md", "02_拍摄执行稿.md"] as readonly string[],
} as const;

/** 兼容旧调用名。 */
export const EXECUTION_CONTEXT_FILES = {
  "09": ["01_项目概览.md", "03_口播脚本.md", "04_分镜与剪辑节奏.md", "05_拍摄清单.md", "08_内容质检报告.md"],
  "10": ["01_项目概览.md", "03_口播脚本.md", "06_封面标题与发布文案.md", "08_内容质检报告.md", "09_成片执行稿.md"],
} as const;
export const QUALITY_REVIEW_CONTEXT_FILES = [] as const;

function selectContext(documents: Array<{ name: string; content: string }>, allowedNames: readonly string[]): string {
  const allowed = new Set<string>(allowedNames);
  return documents
    .filter((document) => allowed.has(document.name))
    .map((document) => `===== ${document.name} =====\n${document.content.trim()}`)
    .join("\n\n");
}

export function documentContext(documents: Array<{ name: string; content: string }>, number: keyof typeof DOCUMENT_CONTEXT_FILES): string {
  return selectContext(documents, DOCUMENT_CONTEXT_FILES[number]);
}

export function productionContext(documents: Array<{ name: string; content: string }>): string {
  return documentContext(documents, "02");
}

/** 旧项目可继续调用；新项目不再生成用户可见的质检报告。 */
export function qualityReviewContext(): string {
  return "";
}

/** 旧项目增强入口兼容。 */
export function executionContext(documents: Array<{ name: string; content: string }>, number: "09" | "10"): string {
  return selectContext(documents, EXECUTION_CONTEXT_FILES[number]);
}

/** 旧项目增强入口兼容。 */
export function executionDocumentInstructions(number: "09" | "10"): string {
  return number === "09"
    ? "将旧项目资料收束成可直接照拍的最终执行稿，主动修复冲突，不再输出新的质检报告。"
    : "延续旧项目最终执行稿口径，生成精简的发布承接内容，不虚构评论和数据。";
}
