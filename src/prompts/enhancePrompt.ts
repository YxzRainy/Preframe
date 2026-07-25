import { parseModelJsonObject } from "../utils/modelJson.js";

export interface EnhanceProjectContext {
  projectName: string;
  metadata: Record<string, unknown>;
  documents: Array<{ name: string; content: string }>;
  accountMemoryPrompt?: string;
}

export interface EnhancedExecutionPackage {
  finalExecutionScript: string;
  postEngagementCopy: string;
}

export const ENHANCED_EXECUTION_FILES = [
  { key: "finalExecutionScript", filename: "09_成片执行稿.md", title: "成片执行稿" },
  { key: "postEngagementCopy", filename: "10_发布承接话术.md", title: "发布承接话术" },
] as const;

export const EXECUTION_CONTEXT_FILES = {
  "09": ["01_项目概览.md", "03_口播脚本.md", "04_分镜与剪辑节奏.md", "05_拍摄清单.md", "08_内容质检报告.md"],
  "10": ["01_项目概览.md", "03_口播脚本.md", "06_封面标题与发布文案.md", "08_内容质检报告.md", "09_成片执行稿.md"],
} as const;

export function executionContext(documents: Array<{ name: string; content: string }>, number: "09" | "10"): string {
  const allowed = new Set<string>(EXECUTION_CONTEXT_FILES[number]);
  return documents
    .filter((document) => allowed.has(document.name))
    .map((document) => `===== ${document.name} =====\n${document.content.trim()}`)
    .join("\n\n");
}

export function executionDocumentInstructions(number: "09" | "10"): string {
  if (number === "09") {
    return `09 专属质量要求：
- “最终推荐开头”必须给出可直接口播的一句话及选择理由。
- “最终逐字口播稿”必须完整、口语化，用户无需拼接其他文档。
- “每5-10秒画面安排”必须使用时间段表格，并写清画面、口播/字幕、拍摄备注。
- “B-roll插入点”必须说明插入位置、素材内容和替代素材。
- “可直接照拍版本”必须把口播、动作、机位和画面提示整合成最终版本。
- 禁止推荐与 projectBrief 或依赖文档无关的工具、产品和选题。`;
  }
  return `10 专属质量要求：
- “置顶评论”必须紧扣当前选题，不使用通用引流话术。
- “评论区高频回复”至少 8 条，覆盖质疑、求步骤、风险、不同平台用户等真实问题。
- “私信回复话术”和“主页/粉丝群承接”必须符合账号定位与内容边界。
- “低风险CTA”必须给出高风险表达、风险原因和可直接替换表达。
- 必须延续 09 的最终口径，禁止引入无关工具、产品或新选题。`;
}

export function buildFallbackExecutionPackage(): EnhancedExecutionPackage {
  return {
    finalExecutionScript: `# 成片执行稿

模型未完整返回，已生成基础执行稿模板。

## 最终推荐开头
请从 03_口播脚本 中选择最稳妥的一版开头，避免夸张承诺和制造对立。

## 最终逐字口播稿
请基于 03_口播脚本 的正文脚本补齐最终逐字稿。表达要口语化，避免绝对化判断。

## 每 5-10 秒画面安排
| 时间段 | 画面安排 | 口播/字幕 | B-roll 插入点 | 拍摄备注 |
| --- | --- | --- | --- | --- |
| 0-5 秒 | 主体正面出镜 | 使用最终推荐开头 | 无 | 保持节奏直接 |
| 5-20 秒 | 按脚本推进核心观点 | 对应正文口播 | 插入相关场景素材 | 避免夸张画面 |
| 20-40 秒 | 展示案例或对比 | 强化用户痛点和解决思路 | 插入替代素材 | 需要人工确认事实 |
| 40-60 秒 | 回到主体总结 | 低风险结尾 CTA | 无 | 不承诺结果 |

## 字幕重点
- 核心痛点
- 关键判断
- 低风险行动建议

## B-roll 插入点
- 讲到用户场景时插入真实场景素材。
- 讲到风险提醒时插入中性说明画面。
- 缺少素材时使用 07_视觉参考提示词 中的场景图方向。

## 结尾 CTA
如果你也遇到类似情况，可以先收藏这条，再对照自己的内容做一次检查。`,
    postEngagementCopy: `# 发布承接话术

模型未完整返回，已生成基础发布承接模板。

## 置顶评论
这条内容只做思路拆解，不承诺任何固定结果。欢迎把你的具体场景写在评论区，我会挑典型问题继续拆。

## 评论区高频回复
1. 这是适合所有人吗？不一定，需要结合你的内容领域和用户基础判断。
2. 可以直接照抄吗？不建议，建议先替换成自己的真实场景。
3. 有没有风险？有，避免夸张承诺、对立表达和未经证实的案例。
4. 新手能做吗？可以从一个小选题开始，不要一次追求完整闭环。
5. 需要什么素材？优先准备真实场景、口播画面和能证明观点的素材。
6. 可以发小红书吗？可以，但文案要更克制，少用绝对化标题。
7. 可以发抖音吗？可以，开头要更直接，但不要制造攻击性冲突。
8. 后续怎么做？先看完播和评论反馈，再决定是否扩展系列。

## 私信回复话术
可以，我先了解你的内容领域、目标用户和当前账号阶段，再判断这个选题怎么改更稳。

## 粉丝群/主页承接话术
主页会持续更新选题拆解、脚本结构和风险检查方法，适合想系统优化内容的人参考。

## 低风险 CTA 替代表达
| 高风险表达 | 风险原因 | 替代表达 |
| --- | --- | --- |
| 保证有效 | 结果承诺 | 可以作为一个检查方向 |
| 必火 | 夸张承诺 | 更容易提升开头清晰度 |
| 照着做就行 | 忽略个体差异 | 建议结合自己的场景调整 |
| 立刻见效 | 时间承诺 | 需要持续观察反馈 |`,
  };
}

function metadataLine(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : "未记录";
}

export function buildEnhancePrompt(context: EnhanceProjectContext): string {
  const sourceDocuments = context.documents
    .map((document) => `\n===== ${document.name} =====\n${document.content.trim()}`)
    .join("\n");
  const accountMemorySection = context.accountMemoryPrompt?.trim()
    ? `

${context.accountMemoryPrompt.trim()}

账号记忆执行要求：
- 09_成片执行稿必须延续账号语气、人设定位和拍摄条件，避免写出账号无法拍摄的镜头。
- 10_发布承接话术必须避开禁用词和内容边界，不使用越界 CTA。
- 有效选题只作为风格参考，无效选题要主动避开相似承接方式。`
    : "";

  return `你是短视频前期策划执行导演。请读取当前项目已有关键策划文档，生成增强执行包，让用户拿到后更接近“直接能拍、能发、能避坑”。

项目名称：${context.projectName}
选题：${metadataLine(context.metadata, "topic")}
平台：${metadataLine(context.metadata, "platform")}
内容主体：${metadataLine(context.metadata, "contentSubject")}
内容领域：${metadataLine(context.metadata, "contentDomain")}
内容风格：${metadataLine(context.metadata, "style")}
目标用户：${metadataLine(context.metadata, "targetAudience")}
${accountMemorySection}

已有策划文档：
${sourceDocuments}

必须只输出一个合法 JSON 对象，不要使用 Markdown 代码围栏，不要添加 JSON 外说明。JSON key 必须为：
{
  "finalExecutionScript": "...",
  "postEngagementCopy": "..."
}

finalExecutionScript 对应文件“09_成片执行稿.md”，必须包含：
# 成片执行稿
## 最终推荐开头
说明为什么选这个开头，并给出可直接口播的一句话。
## 最终逐字口播稿
必须是完整逐字稿，口语化，可直接照念照拍，不要让用户再拼接其他文档。
## 每 5-10 秒画面安排
使用表格，列必须包含：时间段、画面安排、口播/字幕、B-roll 插入点、拍摄备注。
## 字幕重点
列出需要加粗或突出显示的字幕。
## B-roll 插入点
说明插入哪些素材、放在哪一句之后、替代素材是什么。
## 结尾 CTA
给出低风险、平台友好的 CTA，不夸张引流，不承诺结果。

postEngagementCopy 对应文件“10_发布承接话术.md”，必须包含：
# 发布承接话术
## 置顶评论
## 评论区高频回复
至少 8 条，覆盖质疑、求工具、求步骤、担心风险、想要模板、不同平台用户。
## 私信回复话术
## 粉丝群/主页承接话术
## 低风险 CTA 替代表达
用表格列出“高风险表达 / 风险原因 / 替代表达”。

合规限制：
- 不要新增“封面视觉方案”，因为 07_视觉参考提示词 已包含封面、场景、人物、负面、风格提示词。
- AI赚钱/副业：禁止保证收益、躺赚、日入过千、照着抄就赚钱；必须提示个人案例不代表普遍结果，执行效果因人而异。
- 情感：禁止 PUA、性别对立、绝对化判断。
- 医美/健康：禁止疗效承诺，必须提示专业咨询。
- 健身：禁止快速逆袭承诺，强调个体差异。
- 职场成长：禁止空泛鸡汤，必须给具体步骤。
- 不要夸张引流，不要违规承诺，不要编造虚假案例或转账截图。`;
}

export function parseEnhancedExecutionPackage(raw: string): EnhancedExecutionPackage {
  let record: Record<string, unknown>;
  try {
    record = parseModelJsonObject(raw, "增强执行包模型输出");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知解析错误";
    throw new Error(`模型输出不是合法 JSON，无法保存增强执行包。${detail}`, { cause: error });
  }
  if (typeof record.finalExecutionScript !== "string" || !record.finalExecutionScript.trim()) {
    throw new Error("增强执行包缺少 finalExecutionScript。");
  }
  if (typeof record.postEngagementCopy !== "string" || !record.postEngagementCopy.trim()) {
    throw new Error("增强执行包缺少 postEngagementCopy。");
  }
  validateEnhancedMarkdown(record.finalExecutionScript, "成片执行稿", ["最终推荐开头", "最终逐字口播稿", "每 5-10 秒画面安排", "字幕重点", "B-roll 插入点", "结尾 CTA"]);
  validateEnhancedMarkdown(record.postEngagementCopy, "发布承接话术", ["置顶评论", "评论区高频回复", "私信回复话术", "粉丝群/主页承接话术", "低风险 CTA 替代表达"]);
  return {
    finalExecutionScript: record.finalExecutionScript,
    postEngagementCopy: record.postEngagementCopy,
  };
}

function validateEnhancedMarkdown(content: string, title: string, sections: string[]): void {
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
