import { CORE_PROJECT_DOCUMENT_DEFINITIONS, type ContentKey, type CoreContentKey } from "../utils/documentDefinitions.js";
import { parseModelJsonObject } from "../utils/modelJson.js";

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
${accountMemoryPrompt}`;
}

export function buildDocumentPrompt(brief: ProjectBrief, definition: { number: string; title: string; requiredSections: readonly string[]; minLength: number }, context = "", accountMemoryPrompt = "", regenerate = false): string {
  return `你是片策的资深短视频策划。${regenerate ? "上一次生成未通过质量校验，请从头重新创作，不要复述错误内容。" : "请独立生成一份可直接使用的项目文档。"}

统一 projectBrief：
${JSON.stringify(brief, null, 2)}

当前文档：${definition.number}_${definition.title}.md
必须使用一级标题“# ${definition.title}”。
必须包含以下二级标题：${definition.requiredSections.map((item) => `## ${item}`).join("、")}。
正文至少 ${definition.minLength} 个字符，必须具体关联选题、内容主体、平台和目标用户，不能写占位语或通用空模板。
${context ? `仅可参考以下已通过校验的依赖文档：\n${context}` : ""}
${accountMemoryPrompt}

只输出 JSON：{"content":"完整 Markdown"}。不要输出 JSON 外说明。`;
}

export function buildDocumentRepairPrompt(raw: string, errors: string[], definition: { title: string; requiredSections: readonly string[]; minLength: number }): string {
  return `修复下面这份“${definition.title}”文档。问题：${errors.join("；")}。
保留有效内容，补齐二级标题 ${definition.requiredSections.join("、")}，正文至少 ${definition.minLength} 字符。禁止占位语。
只输出 JSON：{"content":"完整 Markdown"}。

待修复输出：
${raw}`;
}

export type GeneratedContent = Record<CoreContentKey, string> & Partial<Record<ContentKey, string>>;

interface ParseGeneratedContentOptions {
  allowDocumentFallback?: boolean;
}

interface GeneratePromptOptions {
  accountMemoryPrompt?: string;
}

export function buildGeneratePrompt(input: GenerateInput, options: GeneratePromptOptions = {}): string {
  const accountMemorySection = options.accountMemoryPrompt?.trim()
    ? `

${options.accountMemoryPrompt.trim()}

账号记忆执行要求：
- 必须贴合账号语气、内容领域、目标用户、人设定位和常用开头风格。
- 禁用词不得出现在标题、脚本、字幕、发布文案、评论话术或视觉提示词中。
- 必须遵守内容边界，不要生成越界选题、越界案例或越界 CTA。
- 拍摄方案必须匹配账号的拍摄设备和常用拍摄场景，缺少条件时给出低成本替代方案。
- 成功选题可作为表达方向参考，失败选题要主动避开相似切入。`
    : "";

  return `请根据以下信息生成一套短视频前期核心策划方案。本阶段只生成 01-08 核心 Markdown 文档；系统会在下一阶段基于这些核心文档继续生成 09_成片执行稿.md 与 10_发布承接话术.md，用户无需二次点击。

选题主题：${input.topic}
平台：${input.platform}
内容主体：${input.contentSubject}
内容领域：${input.contentDomain}
内容风格：${input.style}
目标用户：${input.targetAudience}
补充要求：${input.extraRequirements || "无"}
${accountMemorySection}

必须只输出一个合法 JSON 对象，不要使用 Markdown 代码围栏，不要添加 JSON 外的说明。JSON 字段值均为完整 Markdown 字符串：
{
  "projectOverview": "...",
  "topicAnalysis": "...",
  "spokenScript": "...",
  "storyboardAndEditing": "...",
  "shootingChecklist": "...",
  "coverTitlesAndPostCopy": "...",
  "visualPrompts": "...",
  "qualityCheckReport": "..."
}

各字段必须包含：
1. projectOverview：一级标题“项目概览”，必须包含视频目标、推荐方向、视频结构、执行优先级、岗位视角、人工确认事项。
2. topicAnalysis：一级标题“选题拆解”，必须包含选题核心、用户痛点、内容切入角度、标题方向、内容风险提醒。
3. spokenScript：一级标题“口播脚本”，必须包含“多版本开头”表格：痛点型/反常识型/故事型/直接教学型，每个开头说明平台、优点、风险、是否推荐；还要包含正文脚本、转场提示、结尾引导、口播时长预估。
4. storyboardAndEditing：一级标题“分镜与剪辑节奏”，使用 Markdown 表格呈现每个镜头，列必须包含镜头序号、画面、时长、字幕、剪辑节奏、是否必拍、替代方案、备注。
5. shootingChecklist：一级标题“拍摄清单”，必须区分必拍镜头、可选镜头、可替代素材、场景设备、拍摄风险。
6. coverTitlesAndPostCopy：必须严格使用下面的 Markdown 模板，标题候选必须独占一行并使用数字列表：
   # 封面标题与发布文案
   ## 标题候选
   1. 标题一
   ...至少10条
   ## 标题评分
   | 标题 | 吸引力 | 清晰度 | 平台适配 | 风险 | 总分 |
   | --- | --- | --- | --- | --- | --- |
   ## 推荐理由
   - 推荐使用：
   - 原因：
   ## 小红书发布文案
   ## 抖音发布文案
   ## 标签建议
   避免“必火、暴富、铁饭碗、保证有效”等夸大承诺，也不要为了制造冲突而贬低具体人群。
7. visualPrompts：一级标题“视觉参考提示词”，以及封面视觉提示词、场景图提示词、产品/人物视觉参考提示词、负面提示词、风格关键词。
8. qualityCheckReport：一级标题“内容质检报告”，必须检查 AI 味、夸张承诺、平台风险、拍摄可行性、内容清晰度，并输出且只能使用下面的 Markdown 表格表头：
   | 原表达/场景 | 问题 | 可直接替换的新句子 | 优先级 |
   | ------ | -- | --------- | --- |

内容类型限制规则：
- AI赚钱/副业：禁止保证收益、躺赚、日入过千、照着抄就赚钱；必须提示“个人案例不代表普遍结果，执行效果因人而异”。
- 情感：禁止 PUA、性别对立、绝对化判断，避免煽动羞辱或贴标签。
- 医美/健康：禁止疗效承诺，不得替代医生诊断，必须提示专业咨询。
- 健身：禁止快速逆袭承诺，不承诺固定周期效果，强调个体差异和循序渐进。
- 职场成长：禁止空泛鸡汤，必须给具体步骤、动作、场景和判断标准。

内容质检报告必须更严格：
- 不要只给抽象建议，必须输出“原句 → 问题 → 可直接替换的新句子 → 优先级”。
- 表格列名必须为：原表达/场景、问题、可直接替换的新句子、优先级。
- 表格表头必须原样使用：
  | 原表达/场景 | 问题 | 可直接替换的新句子 | 优先级 |
  | ------ | -- | --------- | --- |
- 必须检查 AI 味、收益承诺、夸张标题、虚假案例、转账截图、平台风险、是否缺少证据、是否需要人工确认。
- “可直接替换的新句子”必须是可以复制进脚本或发布文案的完整句子，不要写“建议弱化”“建议补充证据”这种说明。

内容需具体、避免空话，并准确结合内容主体、内容领域与所选平台。涉及医疗、金融等敏感主题时，主动加入合规与风险提醒。`;
}

interface MarkdownSectionRule {
  label: string;
  heading: RegExp;
  itemCount: number;
}

const LEGACY_COVER_SECTION_RULES: MarkdownSectionRule[] = [
  { label: "10个通用封面标题", heading: /^##\s+10\s*个(?:通用)?封面标题\s*$/m, itemCount: 10 },
  { label: "5个小红书风格标题", heading: /^##\s+5\s*个小红书风格标题\s*$/m, itemCount: 5 },
  { label: "5个抖音风格标题", heading: /^##\s+5\s*个抖音风格标题\s*$/m, itemCount: 5 },
];

const COVER_POST_SECTION_HEADINGS = [
  "标题候选",
  "标题评分",
  "推荐理由",
  "小红书发布文案",
  "抖音发布文案",
  "标签建议",
];

const QUALITY_CHECK_CANONICAL_HEADER = "| 原表达/场景 | 问题 | 可直接替换的新句子 | 优先级 |";
const QUALITY_CHECK_CANONICAL_SEPARATOR = "| ------ | -- | --------- | --- |";
const QUALITY_CHECK_HEADER_ALIASES = [
  ["原表达", "原表达/场景"],
  ["问题"],
  ["可直接替换的新句子", "建议修改"],
  ["优先级"],
];

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function normalizeHeaderText(value: string): string {
  return value.replace(/\s+/g, "");
}

function isMarkdownTableSeparator(line: string | undefined): boolean {
  return Boolean(line?.trim().match(/^\|(?:\s*:?-{2,}:?\s*\|)+\s*$/));
}

function isQualityCheckHeader(cells: string[]): boolean {
  if (cells.length < QUALITY_CHECK_HEADER_ALIASES.length) return false;
  return QUALITY_CHECK_HEADER_ALIASES.every((aliases, index) => {
    const normalized = normalizeHeaderText(cells[index] ?? "");
    return aliases.some((alias) => normalized === normalizeHeaderText(alias));
  });
}

export function buildFallbackQualityCheckReportMarkdown(): string {
  return `# 内容质检报告

模型未完整返回，已生成基础质检模板。

${QUALITY_CHECK_CANONICAL_HEADER}
${QUALITY_CHECK_CANONICAL_SEPARATOR}
| 待人工复核的表达或场景 | 模型未完整返回，需要人工补充具体问题。 | 请根据最终脚本和发布文案补充一条可直接替换的新句子。 | 高 |`;
}

export function fallbackCoreMarkdown(key: CoreContentKey): string {
  const definition = CORE_PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.key === key);
  const title = definition?.title || "待补充文档";
  if (key === "coverTitlesAndPostCopy") {
    return `# 封面标题与发布文案

模型未完整返回，已生成基础模板。

## 标题候选
1. 待补充标题 1
2. 待补充标题 2
3. 待补充标题 3
4. 待补充标题 4
5. 待补充标题 5
6. 待补充标题 6
7. 待补充标题 7
8. 待补充标题 8
9. 待补充标题 9
10. 待补充标题 10

## 标题评分
| 标题 | 吸引力 | 清晰度 | 平台适配 | 风险 | 总分 |
| --- | --- | --- | --- | --- | --- |
| 待补充标题 1 | 待评估 | 待评估 | 待评估 | 待评估 | 待评估 |

## 推荐理由
- 推荐使用：待人工补充
- 原因：模型未完整返回，需要人工复核。

## 小红书发布文案
待人工补充。

## 抖音发布文案
待人工补充。

## 标签建议
#待补充`;
  }
  if (key === "qualityCheckReport") return buildFallbackQualityCheckReportMarkdown();
  return `# ${title}

模型未完整返回，已生成基础占位文档。

## 待人工补充
- 请根据项目主题补充 ${title} 的具体内容。
- 请复核内容风险、拍摄可行性和平台适配。`;
}

function stringField(record: Record<string, unknown>, key: CoreContentKey, allowFallback: boolean): string {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value;
  if (allowFallback) return fallbackCoreMarkdown(key);
  throw new Error(`模型输出缺少有效字段：${key}。请重试。`);
}

export function normalizeQualityCheckReportMarkdown(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!/^#\s+内容质检报告\s*$/m.test(normalized)) {
    return buildFallbackQualityCheckReportMarkdown();
  }

  const lines = normalized.split("\n");
  const headerIndex = lines.findIndex((line, index) => {
    const cells = splitMarkdownTableRow(line);
    return Boolean(cells && isQualityCheckHeader(cells) && isMarkdownTableSeparator(lines[index + 1]));
  });

  if (headerIndex < 0) {
    return buildFallbackQualityCheckReportMarkdown();
  }

  lines[headerIndex] = QUALITY_CHECK_CANONICAL_HEADER;
  lines[headerIndex + 1] = QUALITY_CHECK_CANONICAL_SEPARATOR;
  return lines.join("\n");
}

export function validateQualityCheckReportMarkdown(content: string): void {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!/^#\s+内容质检报告\s*$/m.test(normalized)) {
    throw new Error("内容质检报告缺少一级标题“# 内容质检报告”。");
  }
  const lines = normalized.split("\n");
  const hasTable = lines.some((line, index) => {
    const cells = splitMarkdownTableRow(line);
    return Boolean(cells && isQualityCheckHeader(cells) && isMarkdownTableSeparator(lines[index + 1]));
  });
  if (!hasTable) {
    throw new Error("内容质检报告必须包含“原表达/场景/问题/可直接替换的新句子/优先级”表格。");
  }
}

function validateRequiredMarkdownSections(content: string, title: string, sections: string[]): void {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!new RegExp(`^#\\s+${title}\\s*$`, "m").test(normalized)) {
    throw new Error(`${title}缺少一级标题“# ${title}”。`);
  }
  for (const section of sections) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, "m").test(normalized)) {
      throw new Error(`${title}缺少二级标题“${section}”。`);
    }
  }
}

export function validateFinalExecutionScriptMarkdown(content: string): void {
  validateRequiredMarkdownSections(content, "成片执行稿", ["最终推荐开头", "最终逐字口播稿", "每 5-10 秒画面安排", "字幕重点", "B-roll 插入点", "结尾 CTA"]);
}

export function validatePostEngagementCopyMarkdown(content: string): void {
  validateRequiredMarkdownSections(content, "发布承接话术", ["置顶评论", "评论区高频回复", "私信回复话术", "粉丝群/主页承接话术", "低风险 CTA 替代表达"]);
}

export function hasCompleteExecutionPackage(content: GeneratedContent): content is GeneratedContent & Required<Pick<GeneratedContent, "finalExecutionScript" | "postEngagementCopy">> {
  return Boolean(content.finalExecutionScript?.trim() && content.postEngagementCopy?.trim());
}

/** 防止封面标题被模型用分号挤成一个普通段落。 */
export function validateLegacyCoverTitlesMarkdown(content: string): void {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!/^#\s+封面标题\s*$/m.test(normalized)) {
    throw new Error("封面标题缺少一级标题“# 封面标题”。");
  }

  for (const rule of LEGACY_COVER_SECTION_RULES) {
    const match = rule.heading.exec(normalized);
    if (!match || match.index === undefined) {
      throw new Error(`封面标题缺少 Markdown 二级标题“${rule.label}”。`);
    }
    const sectionStart = match.index + match[0].length;
    const remaining = normalized.slice(sectionStart);
    const nextHeading = remaining.search(/^##\s+/m);
    const section = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;
    const items = section.match(/^\s*\d+[.、)]\s+\S.+$/gm) ?? [];
    if (items.length !== rule.itemCount) {
      throw new Error(`${rule.label}应有 ${rule.itemCount} 条独立编号标题，实际为 ${items.length} 条。`);
    }
  }

  if (!/^##\s+标题使用建议\s*$/m.test(normalized)) {
    throw new Error("封面标题缺少 Markdown 二级标题“标题使用建议”。");
  }
}

export function validateCoverPublishingMarkdown(content: string): void {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!/^#\s+封面标题与发布文案\s*$/m.test(normalized)) {
    throw new Error("封面标题与发布文案缺少一级标题“# 封面标题与发布文案”。");
  }

  for (const heading of COVER_POST_SECTION_HEADINGS) {
    const pattern = new RegExp(`^##\\s+${heading}\\s*$`, "m");
    if (!pattern.test(normalized)) {
      throw new Error(`封面标题与发布文案缺少 Markdown 二级标题“${heading}”。`);
    }
  }

  const candidateMatch = /^##\s+标题候选\s*$/m.exec(normalized);
  if (!candidateMatch || candidateMatch.index === undefined) {
    throw new Error("封面标题与发布文案缺少标题候选。");
  }
  const candidateSectionStart = candidateMatch.index + candidateMatch[0].length;
  const remaining = normalized.slice(candidateSectionStart);
  const nextHeading = remaining.search(/^##\s+/m);
  const candidateSection = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;
  const items = candidateSection.match(/^\s*\d+[.、)]\s+\S.+$/gm) ?? [];
  if (items.length < 10) {
    throw new Error(`标题候选应至少有 10 条独立编号标题，实际为 ${items.length} 条。`);
  }

  if (!/\|\s*标题\s*\|\s*吸引力\s*\|\s*清晰度\s*\|\s*平台适配\s*\|\s*风险\s*\|\s*总分\s*\|/m.test(normalized)) {
    throw new Error("标题评分缺少包含“标题/吸引力/清晰度/平台适配/风险/总分”的 Markdown 表格。");
  }
}

export function validateCoverDocumentMarkdown(content: string): void {
  if (/^#\s+封面标题与发布文案\s*$/m.test(content.replace(/\r\n/g, "\n"))) {
    validateCoverPublishingMarkdown(content);
    return;
  }
  validateLegacyCoverTitlesMarkdown(content);
}

/** 首次输出格式不合格时，要求模型只修复结构并重新返回完整 JSON。 */
export function buildGenerateRepairPrompt(raw: string, reason: string, accountMemoryPrompt?: string): string {
  const accountMemorySection = accountMemoryPrompt?.trim()
    ? `

修复时仍必须遵守以下账号记忆，尤其是禁用词、内容边界、账号语气和拍摄条件：
${accountMemoryPrompt.trim()}`
    : "";

  return `上一次输出无法被程序保存，原因：${reason}

请修复下面的输出，并重新返回包含 01-08 核心字段的完整合法 JSON。不要使用 Markdown 代码围栏，不要输出解释。

必须使用这些 JSON key：
projectOverview, topicAnalysis, spokenScript, storyboardAndEditing, shootingChecklist, coverTitlesAndPostCopy, visualPrompts, qualityCheckReport

特别注意 coverTitlesAndPostCopy 必须包含以下结构：
# 封面标题与发布文案
## 标题候选
## 标题评分
## 推荐理由
## 小红书发布文案
## 抖音发布文案
## 标签建议

禁止用分号把多个标题串在同一段。其他字段保留原有有效内容。

qualityCheckReport 必须包含以下标准表格；如果原文缺失，请补出基础质检项：
# 内容质检报告
| 原表达/场景 | 问题 | 可直接替换的新句子 | 优先级 |
| ------ | -- | --------- | --- |
${accountMemorySection}

上一次输出：
${raw}`;
}

/** 解析并严格校验模型的结构化输出。 */
export function parseGeneratedContent(raw: string, options: ParseGeneratedContentOptions = {}): GeneratedContent {
  let value: Record<string, unknown>;
  try {
    value = parseModelJsonObject(raw, "模型输出");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知解析错误";
    throw new Error(`模型结构化输出自动解析失败。${detail}`, { cause: error });
  }

  const record = value;
  for (const { key } of CORE_PROJECT_DOCUMENT_DEFINITIONS) {
    record[key] = stringField(record, key, Boolean(options.allowDocumentFallback));
  }
  try {
    validateCoverPublishingMarkdown(record.coverTitlesAndPostCopy as string);
  } catch (error) {
    if (!options.allowDocumentFallback) throw error;
    record.coverTitlesAndPostCopy = fallbackCoreMarkdown("coverTitlesAndPostCopy");
  }
  try {
    record.qualityCheckReport = normalizeQualityCheckReportMarkdown(record.qualityCheckReport as string);
    validateQualityCheckReportMarkdown(record.qualityCheckReport as string);
  } catch (error) {
    if (!options.allowDocumentFallback) throw error;
    record.qualityCheckReport = buildFallbackQualityCheckReportMarkdown();
  }
  const hasFinalExecutionScript = typeof record.finalExecutionScript === "string" && record.finalExecutionScript.trim().length > 0;
  const hasPostEngagementCopy = typeof record.postEngagementCopy === "string" && record.postEngagementCopy.trim().length > 0;
  if (hasFinalExecutionScript !== hasPostEngagementCopy) {
    delete record.finalExecutionScript;
    delete record.postEngagementCopy;
  }
  if (typeof record.finalExecutionScript === "string" && typeof record.postEngagementCopy === "string") {
    try {
      validateFinalExecutionScriptMarkdown(record.finalExecutionScript);
      validatePostEngagementCopyMarkdown(record.postEngagementCopy);
    } catch {
      delete record.finalExecutionScript;
      delete record.postEngagementCopy;
    }
  }
  return record as GeneratedContent;
}
