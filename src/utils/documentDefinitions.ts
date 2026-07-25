/** 占位语列表：含任意一条的文档不得通过校验。 */
export const PLACEHOLDER_PHRASES = [
  "模型未完整返回",
  "已生成基础占位文档",
  "待人工补充",
  "请根据项目主题补充",
  "请根据主题补充",
  "请复核内容",
  "通用空模板",
  "基础执行稿模板",
  "基础发布承接模板",
  "基础质检模板",
] as const;

export const CORE_PROJECT_DOCUMENT_DEFINITIONS = [
  {
    key: "projectOverview",
    number: "01",
    title: "项目概览",
    filename: "01_项目概览.md",
    parts: ["视频目标", "推荐方向", "执行优先级"],
    fallbackCopy: ["视频目标与推荐方向", "结构、岗位视角与确认事项"],
    minLength: 500,
    requiredSections: ["视频目标", "推荐方向", "视频结构", "执行优先级", "风险边界"],
  },
  {
    key: "topicAnalysis",
    number: "02",
    title: "选题拆解",
    filename: "02_选题拆解.md",
    parts: ["用户痛点", "内容切入", "标题方向"],
    fallbackCopy: ["如何让选题更接近真实用户需求", "痛点、切入角度与风险提醒"],
    minLength: 600,
    requiredSections: ["选题核心", "用户痛点", "内容切入角度", "标题方向", "内容风险提醒"],
  },
  {
    key: "spokenScript",
    number: "03",
    title: "口播脚本",
    filename: "03_口播脚本.md",
    parts: ["多版本开头", "正文脚本", "结尾引导"],
    fallbackCopy: ["痛点型、反常识型、故事型开头", "正文节奏、转场与行动引导"],
    minLength: 900,
    requiredSections: ["多版本开头", "正文脚本", "转场提示", "结尾引导", "口播时长预估"],
  },
  {
    key: "storyboardAndEditing",
    number: "04",
    title: "分镜与剪辑节奏",
    filename: "04_分镜与剪辑节奏.md",
    parts: ["画面", "时长", "剪辑节奏"],
    fallbackCopy: ["镜头画面、字幕与剪辑节奏", "必拍判断、替代方案与备注"],
    minLength: 700,
    requiredSections: ["分镜表", "剪辑节奏", "必拍镜头", "替代方案"],
  },
  {
    key: "shootingChecklist",
    number: "05",
    title: "拍摄清单",
    filename: "05_拍摄清单.md",
    parts: ["必拍镜头", "可选素材", "拍摄风险"],
    fallbackCopy: ["必拍镜头、可选镜头与替代素材", "场景设备准备和拍摄风险"],
    minLength: 500,
    requiredSections: ["必拍镜头", "可选镜头", "可替代素材", "场景设备", "拍摄风险"],
  },
  {
    key: "coverTitlesAndPostCopy",
    number: "06",
    title: "封面标题与发布文案",
    filename: "06_封面标题与发布文案.md",
    parts: ["标题评分", "发布文案", "标签建议"],
    fallbackCopy: ["标题候选、评分与推荐理由", "小红书、抖音文案与标签建议"],
    minLength: 800,
    requiredSections: ["标题候选", "标题评分", "推荐理由", "小红书发布文案", "抖音发布文案", "标签建议"],
  },
  {
    key: "visualPrompts",
    number: "07",
    title: "视觉参考提示词",
    filename: "07_视觉参考提示词.md",
    parts: ["封面视觉", "场景图", "负面提示"],
    fallbackCopy: ["高质感、真实工作场景", "画面风格、镜头语言与负面词"],
    minLength: 500,
    requiredSections: ["封面视觉提示词", "场景图提示词", "人物视觉提示词", "负面提示词", "风格关键词"],
  },
  {
    key: "qualityCheckReport",
    number: "08",
    title: "内容质检报告",
    filename: "08_内容质检报告.md",
    parts: ["AI 味", "平台风险", "可行性"],
    fallbackCopy: ["AI 味、夸张承诺与平台风险", "原表达/场景、问题、可直接替换的新句子与优先级"],
    minLength: 600,
    // 08 用质检表格验证（validateQualityCheckReportMarkdown），不用二级标题校验
    requiredSections: [] as unknown as readonly string[],
  },
] as const;

export const EXECUTION_DOCUMENT_DEFINITIONS = [
  {
    key: "finalExecutionScript",
    number: "09",
    title: "成片执行稿",
    filename: "09_成片执行稿.md",
    parts: ["逐字稿", "画面安排", "B-roll"],
    fallbackCopy: ["最终推荐开头与逐字口播稿", "每 5-10 秒画面安排和结尾 CTA"],
    minLength: 1000,
    requiredSections: ["最终推荐开头", "最终逐字口播稿", "每5-10秒画面安排", "字幕重点", "B-roll插入点", "结尾CTA", "可直接照拍版本"],
  },
  {
    key: "postEngagementCopy",
    number: "10",
    title: "发布承接话术",
    filename: "10_发布承接话术.md",
    parts: ["置顶评论", "私信回复", "低风险 CTA"],
    fallbackCopy: ["评论区、私信和主页承接话术", "低风险 CTA 替代表达"],
    minLength: 700,
    requiredSections: ["置顶评论", "评论区高频回复", "私信回复话术", "主页/粉丝群承接", "低风险CTA"],
  },
] as const;

export const PROJECT_DOCUMENT_DEFINITIONS = [
  ...CORE_PROJECT_DOCUMENT_DEFINITIONS,
  ...EXECUTION_DOCUMENT_DEFINITIONS,
] as const;

export const LEGACY_DOCUMENT_DEFINITIONS = [
  { filename: "01_选题拆解.md", number: "01", title: "选题拆解" },
  { filename: "02_口播脚本.md", number: "02", title: "口播脚本" },
  { filename: "03_分镜草案.md", number: "03", title: "分镜草案" },
  { filename: "04_拍摄清单.md", number: "04", title: "拍摄清单" },
  { filename: "05_封面标题.md", number: "05", title: "封面标题" },
  { filename: "06_视觉参考提示词.md", number: "06", title: "视觉参考提示词" },
] as const;

export type ContentKey = (typeof PROJECT_DOCUMENT_DEFINITIONS)[number]["key"];
export type CoreContentKey = (typeof CORE_PROJECT_DOCUMENT_DEFINITIONS)[number]["key"];
export type ProjectDocumentDefinition = (typeof PROJECT_DOCUMENT_DEFINITIONS)[number];

const CANONICAL_FILENAMES: ReadonlySet<string> = new Set(PROJECT_DOCUMENT_DEFINITIONS.map((definition) => definition.filename));
const LEGACY_FILENAMES: ReadonlySet<string> = new Set(LEGACY_DOCUMENT_DEFINITIONS.map((definition) => definition.filename));

export function isPrimaryProjectDocument(filename: string): boolean {
  return CANONICAL_FILENAMES.has(filename) || LEGACY_FILENAMES.has(filename);
}

export function isVisualPromptDocument(filename: string): boolean {
  return /^(?:07|06)_视觉参考提示词/u.test(filename);
}

export function isCoverPublishingDocument(filename: string): boolean {
  return /^(?:06_封面标题与发布文案|05_封面标题)/u.test(filename);
}

export function displayDocumentName(filename: string): { number: string; title: string; revised: boolean } {
  const baseName = filename.replace(/_修改版(?:_\d+)?(?=\.md$)/u, "");
  const canonical = PROJECT_DOCUMENT_DEFINITIONS.find((definition) => definition.filename === baseName);
  const legacy = LEGACY_DOCUMENT_DEFINITIONS.find((definition) => definition.filename === baseName);
  const number = filename.match(/^(\d{2})_/)?.[1] ?? "•";
  const title = (canonical ?? legacy)?.title ?? filename.replace(/^\d{2}_/, "").replace(/\.md$/i, "").replace(/_修改版(?:_\d+)?$/u, "");
  return { number: (canonical ?? legacy)?.number ?? number, title, revised: /_修改版/u.test(filename) };
}
