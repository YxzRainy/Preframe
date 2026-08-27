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

function documentSpecificInstructions(number: string): string {
  if (number === "04") {
    return "分镜、字幕和节奏必须逐段对应依赖中的口播脚本，不得另写一套论点或案例。";
  }
  if (number === "05") {
    return "拍摄清单必须覆盖依赖口播脚本中的主要场景、动作和证据素材，并给出无法实拍时的替代素材。";
  }
  if (number === "08") {
    return `这是一份针对依赖文档的真实质检，不是通用检查清单。必须逐项引用依赖中的具体原句或场景。
必须包含一个 Markdown 表格，表头至少包含“文档/位置｜原表达/场景｜问题｜可直接替换的新句子｜优先级”，并给出至少 3 条修改项，其中至少 1 条为高优先级。
表格之后给出“可直接发布/修改后可发布/不建议发布”三选一结论；没有证据的问题不要虚构。`;
  }
  return "";
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
${definition.requiredSections.length
    ? `必须包含以下二级标题：${definition.requiredSections.map((item) => `## ${item}`).join("、")}。`
    : "二级标题可按内容组织，但必须让用户能够快速定位结论、证据和修改动作。"}
正文至少 ${definition.minLength} 个字符，必须具体关联选题、内容主体、平台和目标用户，不能写占位语或通用空模板。
${context ? `仅可参考以下已通过校验的依赖文档：\n${context}` : ""}
${documentSpecificInstructions(definition.number)}
${accountMemoryPrompt}

${HUMAN_WRITING_RULES}

只输出 JSON：{"content":"完整 Markdown"}。不要输出 JSON 外说明。`;
}

export function buildDocumentRepairPrompt(
  raw: string,
  errors: string[],
  definition: { number: string; title: string; requiredSections: readonly string[]; minLength: number },
  brief: ProjectBrief,
  input: GenerateInput,
  context = "",
  accountMemoryPrompt = "",
): string {
  return `修复下面这份“${definition.title}”文档。问题：${errors.join("；")}。
保留有效内容，${definition.requiredSections.length ? `补齐二级标题 ${definition.requiredSections.join("、")}，` : "保留清晰的 Markdown 层级，"}正文至少 ${definition.minLength} 字符。禁止占位语。
修复后必须继续明确关联选题“${input.topic}”、内容主体“${input.contentSubject}”、平台“${input.platform}”和目标用户“${input.targetAudience}”。

统一 projectBrief：
${JSON.stringify(brief, null, 2)}
${context ? `仍须遵循以下已通过校验的依赖文档：\n${context}` : ""}
${documentSpecificInstructions(definition.number)}
${accountMemoryPrompt}

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
