import { HUMAN_WRITING_RULES } from "./humanWritingRules.js";

export interface GenerateInput {
  projectName?: string;
  topic: string;
  platform: string;
  contentSubject: string;
  contentDomain: string;
  style: string;
  targetAudience: string;
  extraRequirements?: string;
}

export interface ProjectBrief {
  topic: string;
  contentSubject: string;
  contentDomain: string;
  platform: string;
  style: string;
  targetAudience: string;
  extraRequirements: string;
  coreViewpoint: string;
  contentStructure: string;
  riskBoundaries: string;
}

export function buildProjectBriefPrompt(input: GenerateInput, accountMemoryPrompt = ""): string {
  return `请把以下短视频项目整理为统一 projectBrief。只输出 JSON 对象，不要代码围栏或解释。
{
  "coreViewpoint": "一句明确、可论证的核心观点",
  "contentStructure": "开头、论证、案例/步骤、结尾的结构",
  "riskBoundaries": "内容边界、事实核验和平台风险"
}

选题：${input.topic}
内容主体：${input.contentSubject}
内容领域：${input.contentDomain}
平台：${input.platform}
风格：${input.style}
目标用户：${input.targetAudience}
补充要求：${input.extraRequirements || "无"}
${accountMemoryPrompt}

${HUMAN_WRITING_RULES}`;
}

export function buildDocumentPrompt(
  brief: ProjectBrief,
  definition: { number: string; title: string; requiredSections: readonly string[]; minLength: number },
  context = "",
  accountMemoryPrompt = "",
  regenerate = false,
): string {
  return `你是片策的资深短视频策划。${regenerate ? "上一次生成未通过质量校验，请从头重新创作，不要复述错误内容。" : "请独立生成一份可直接使用的项目文档。"}

统一 projectBrief：
${JSON.stringify(brief, null, 2)}

当前文档：${definition.number}_${definition.title}.md
必须使用一级标题“# ${definition.title}”。
必须包含以下二级标题：${definition.requiredSections.map((item) => `## ${item}`).join("、")}。
正文至少 ${definition.minLength} 个字符，必须具体关联选题、内容主体、平台和目标用户，不能写占位语或通用空模板。
${context ? `仅可参考以下已通过校验的依赖文档：\n${context}` : ""}
${accountMemoryPrompt}

${HUMAN_WRITING_RULES}

只输出 JSON：{"content":"完整 Markdown"}。不要输出 JSON 外说明。`;
}

export function buildDocumentRepairPrompt(
  raw: string,
  errors: string[],
  definition: { title: string; requiredSections: readonly string[]; minLength: number },
): string {
  return `修复下面这份“${definition.title}”文档。问题：${errors.join("；")}。
保留有效内容，补齐二级标题 ${definition.requiredSections.join("、")}，正文至少 ${definition.minLength} 字符。禁止占位语。
只输出 JSON：{"content":"修复后的完整 Markdown"}。

原始输出：
${raw}`;
}

/** 兼容修改旧项目时的 06 文档结构校验。新项目的严格校验由 documentGeneration 负责。 */
export function validateCoverDocumentMarkdown(content: string): void {
  const normalized = content.replace(/\r\n/g, "\n");
  const currentSections = ["标题候选", "标题评分", "推荐理由", "小红书发布文案", "抖音发布文案", "标签建议"];
  const legacySections = ["10个通用封面标题", "5个小红书风格标题", "5个抖音风格标题", "标题使用建议"];
  const current = /^#\s+封面标题与发布文案\s*$/mu.test(normalized);
  const legacy = /^#\s+封面标题\s*$/mu.test(normalized);
  if (!current && !legacy) throw new Error("封面文档缺少正确的一级标题。");
  for (const section of current ? currentSections : legacySections) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, "mu").test(normalized)) {
      throw new Error(`封面文档缺少二级标题“${section}”。`);
    }
  }
}
