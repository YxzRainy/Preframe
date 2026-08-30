import { validateCoverDocumentMarkdown } from "./generatePrompt.js";
import { isCoverPublishingDocument } from "../utils/documentDefinitions.js";
import { parseModelJsonObject } from "../utils/modelJson.js";
import { HUMAN_WRITING_RULES } from "./humanWritingRules.js";

export interface RefineDocument {
  label: string;
  filename: string;
  content: string;
}

export function buildRefinePrompt(documents: RefineDocument[], instruction: string, referencePack = ""): string {
  const originals = documents
    .map((doc) => `\n===== ${doc.label}（${doc.filename}）=====\n${doc.content}`)
    .join("\n");
  const coverFormatRequirement = documents.some((doc) => isCoverPublishingDocument(doc.filename))
    ? `
如果修改的是“03_发布与复盘.md”，必须保留“最终发布卡、平台发布文案、置顶评论、发布记录、数据复盘、复用与下一步”六个二级标题，并保持未知数据为“发布后填写”。旧项目封面文件保持其原结构。`
    : "";

  return `请根据修改意见优化以下短视频策划内容。

修改意见：${instruction}
${originals}
${referencePack ? `\n===== 项目依据包（优先遵守，不要把空白项补写成事实）=====\n${referencePack}` : ""}

必须只输出一个合法 JSON 对象，不要使用 Markdown 代码围栏，不要添加额外说明。键名必须与原文件名完全相同，值为修改后的完整 Markdown 内容。例如：
{
  "02_拍摄执行稿.md": "# 拍摄执行稿\\n..."
}

保留原内容中有效信息，只修改用户要求涉及的部分；输出应可直接替换为一份完整文档。项目依据包中的“事实”只能按原意使用，缺少证据时宁可保留不确定性；“禁区”不得违反。
${HUMAN_WRITING_RULES}${coverFormatRequirement}`;
}

/**
 * 模型偶尔会把提示词中的“===== 文件名 =====”边界一起抄进 Markdown。
 * 文档必须从一级标题开始；这里统一去掉边界和标题前解释，避免污染预览、复制与导出。
 */
export function normalizeRefinedMarkdown(content: string): string {
  let normalized = content.replace(/\r\n?/g, "\n").trim();
  const firstHeading = normalized.search(/^#\s+\S.*$/mu);
  if (firstHeading > 0) normalized = normalized.slice(firstHeading);
  const referencePackBoundary = normalized.search(/^\s*={4,}\s*项目依据包[^\n]*={4,}\s*$/mu);
  if (referencePackBoundary >= 0) normalized = normalized.slice(0, referencePackBoundary);
  normalized = normalized
    .split("\n")
    .filter((line) => !/^\s*={4,}\s*.+?[（(][^）)\n]*\.md[）)]\s*={4,}\s*$/u.test(line))
    .join("\n")
    .trim();
  return normalized;
}

export function parseRefinedContent(raw: string, filenames: string[]): Record<string, string> {
  let record: Record<string, unknown>;
  try {
    record = parseModelJsonObject(raw, "修改模型输出");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知解析错误";
    throw new Error(`模型输出不是合法 JSON，无法保存修改版 Markdown。${detail}`, { cause: error });
  }
  const normalized: Record<string, string> = {};
  for (const filename of filenames) {
    if (typeof record[filename] !== "string" || !record[filename].trim()) {
      throw new Error(`模型返回缺少修改文件：${filename}。`);
    }
    normalized[filename] = normalizeRefinedMarkdown(record[filename] as string);
    if (!normalized[filename]) throw new Error(`模型返回的修改文件为空：${filename}。`);
    if (isCoverPublishingDocument(filename)) {
      validateCoverDocumentMarkdown(normalized[filename]);
    }
  }
  return normalized;
}

export function buildRefineRepairPrompt(raw: string, filename: string, reason: string): string {
  const structure = filename === "03_发布与复盘.md"
    ? "必须保留一级标题 # 发布与复盘，以及二级标题：最终发布卡、平台发布文案、置顶评论、发布记录、数据复盘、复用与下一步。"
    : "必须保留原文件的一级、二级标题结构。";
  return `上一次修改结果的 Markdown 格式不合格，原因：${reason}

请只输出合法 JSON，不要代码围栏或解释。键名必须是“${filename}”，值必须是完整 Markdown。
${structure}

待修复输出：
${raw}`;
}
