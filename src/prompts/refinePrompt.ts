import { validateCoverDocumentMarkdown } from "./generatePrompt.js";
import { isCoverPublishingDocument } from "../utils/documentDefinitions.js";
import { parseModelJsonObject } from "../utils/modelJson.js";
import { HUMAN_WRITING_RULES } from "./humanWritingRules.js";

export interface RefineDocument {
  label: string;
  filename: string;
  content: string;
}

export function buildRefinePrompt(documents: RefineDocument[], instruction: string): string {
  const originals = documents
    .map((doc) => `\n===== ${doc.label}（${doc.filename}）=====\n${doc.content}`)
    .join("\n");
  const coverFormatRequirement = documents.some((doc) => isCoverPublishingDocument(doc.filename))
    ? `\n如果修改的是封面标题与发布文案，必须保留原文件现有结构。新项目文件应包含“# 封面标题与发布文案”以及“标题候选、标题评分、推荐理由、小红书发布文案、抖音发布文案、标签建议”；旧项目“# 封面标题”文件应保留原有四个二级标题。标题候选必须独占一行，禁止用分号串联。`
    : "";

  return `请根据修改意见优化以下短视频策划内容。

修改意见：${instruction}
${originals}

必须只输出一个合法 JSON 对象，不要使用 Markdown 代码围栏，不要添加额外说明。键名必须与原文件名完全相同，值为修改后的完整 Markdown 内容。例如：
{
  "02_口播脚本.md": "# 口播脚本\\n..."
}

保留原内容中有效信息，只修改用户要求涉及的部分；输出应可直接替换为一份完整文档。
${HUMAN_WRITING_RULES}${coverFormatRequirement}`;
}

export function parseRefinedContent(raw: string, filenames: string[]): Record<string, string> {
  let record: Record<string, unknown>;
  try {
    record = parseModelJsonObject(raw, "修改模型输出");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知解析错误";
    throw new Error(`模型输出不是合法 JSON，无法保存修改版 Markdown。${detail}`, { cause: error });
  }
  for (const filename of filenames) {
    if (typeof record[filename] !== "string" || !record[filename].trim()) {
      throw new Error(`模型返回缺少修改文件：${filename}。`);
    }
    if (isCoverPublishingDocument(filename)) {
      validateCoverDocumentMarkdown(record[filename] as string);
    }
  }
  return record as Record<string, string>;
}

export function buildRefineRepairPrompt(raw: string, filename: string, reason: string): string {
  return `上一次修改结果的 Markdown 格式不合格，原因：${reason}

请只输出合法 JSON，不要代码围栏或解释。键名必须是“${filename}”，值必须是完整 Markdown。
封面标题与发布文案必须保留原文件结构。新结构应包含：
# 封面标题与发布文案
## 标题候选
## 标题评分
## 推荐理由
## 小红书发布文案
## 抖音发布文案
## 标签建议

旧结构应包含“# 封面标题”，以及以下二级标题：
## 10个通用封面标题
## 5个小红书风格标题
## 5个抖音风格标题
## 标题使用建议
每条标题必须独占一行，禁止用分号串联。

待修复输出：
${raw}`;
}
