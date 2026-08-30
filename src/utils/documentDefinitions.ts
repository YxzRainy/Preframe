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

/**
 * 新项目只生成三份用户真正会继续使用的主文档。
 * 质检、分镜视图、拍摄清单和平台适配都由这三份文档的结构化内容派生，
 * 不再把模型的中间思考过程拆成十篇互相复制的 Markdown。
 */
export const CORE_PROJECT_DOCUMENT_DEFINITIONS = [
  {
    key: "creativeBrief",
    number: "01",
    title: "创作简报",
    filename: "01_创作简报.md",
    parts: ["目标用户与任务", "核心观点", "硬约束"],
    fallbackCopy: ["为什么做、给谁看、看完要获得什么", "时长、保留项、禁用项和事实边界"],
    minLength: 300,
    maxLength: 1200,
    requiredSections: ["目标与用户", "核心观点", "内容结构", "执行约束", "事实与风险边界", "人工确认"],
  },
  {
    key: "shootingExecution",
    number: "02",
    title: "拍摄执行稿",
    filename: "02_拍摄执行稿.md",
    parts: ["最终逐字稿", "镜头执行表", "场景与素材"],
    fallbackCopy: ["唯一锁稿口径与时长", "提词、拍摄、字幕和剪辑共用的一张执行表"],
    minLength: 700,
    maxLength: 3500,
    requiredSections: ["执行摘要", "最终逐字口播稿", "镜头执行表", "场景与设备", "素材与替代方案", "拍摄风险", "锁稿检查"],
  },
  {
    key: "publishAndReview",
    number: "03",
    title: "发布与复盘",
    filename: "03_发布与复盘.md",
    parts: ["最终发布卡", "平台文案", "真实数据复盘"],
    fallbackCopy: ["最终标题、封面和发布文案", "发布记录、数据回收与下一轮复用"],
    minLength: 500,
    maxLength: 2000,
    requiredSections: ["最终发布卡", "平台发布文案", "置顶评论", "发布记录", "数据复盘", "复用与下一步"],
  },
] as const;

/** 保留旧导出名，避免现有调用方在迁移期间失效。 */
export const EXECUTION_DOCUMENT_DEFINITIONS = [] as const;
export const PROJECT_DOCUMENT_DEFINITIONS = [...CORE_PROJECT_DOCUMENT_DEFINITIONS] as const;

/**
 * 历史项目仍可浏览、修改和继续执行，但不会参与新项目的“三文档完整度”计算。
 */
export const LEGACY_DOCUMENT_DEFINITIONS = [
  { filename: "01_项目概览.md", number: "01", title: "项目概览" },
  { filename: "02_选题拆解.md", number: "02", title: "选题拆解" },
  { filename: "03_口播脚本.md", number: "03", title: "口播脚本" },
  { filename: "04_分镜与剪辑节奏.md", number: "04", title: "分镜与剪辑节奏" },
  { filename: "05_拍摄清单.md", number: "05", title: "拍摄清单" },
  { filename: "06_封面标题与发布文案.md", number: "06", title: "封面标题与发布文案" },
  { filename: "07_视觉参考提示词.md", number: "07", title: "视觉参考提示词" },
  { filename: "08_内容质检报告.md", number: "08", title: "内容质检报告" },
  { filename: "09_成片执行稿.md", number: "09", title: "成片执行稿" },
  { filename: "10_发布承接话术.md", number: "10", title: "发布承接话术" },
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
  return /^(?:03_发布与复盘|06_封面标题与发布文案|05_封面标题)/u.test(filename);
}

export function displayDocumentName(filename: string): { number: string; title: string; revised: boolean } {
  const baseName = filename.replace(/_修改版(?:_\d+)?(?=\.md$)/u, "");
  const canonical = PROJECT_DOCUMENT_DEFINITIONS.find((definition) => definition.filename === baseName);
  const legacy = LEGACY_DOCUMENT_DEFINITIONS.find((definition) => definition.filename === baseName);
  const number = filename.match(/^(\d{2})_/)?.[1] ?? "•";
  const title = (canonical ?? legacy)?.title ?? filename.replace(/^\d{2}_/, "").replace(/\.md$/i, "").replace(/_修改版(?:_\d+)?$/u, "");
  return { number: (canonical ?? legacy)?.number ?? number, title, revised: /_修改版/u.test(filename) };
}
