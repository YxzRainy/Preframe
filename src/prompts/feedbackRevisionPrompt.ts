import { HUMAN_WRITING_RULES } from "./humanWritingRules.js";

export const FEEDBACK_REVISION_FILES = [
  "03_口播脚本.md",
  "04_分镜与剪辑节奏.md",
  "05_拍摄清单.md",
  "09_成片执行稿.md",
] as const;

export function buildFeedbackRevisionPrompt(
  project: { topic: string; platform: string; contentSubject: string; contentDomain: string; style: string; targetAudience: string },
  documents: Array<{ name: string; content: string }>,
  feedback: string,
  strategy = "",
): string {
  const source = documents.map((doc) => `===== ${doc.name} =====\n${doc.content.trim()}`).join("\n\n");
  return `你是短视频现场编导。请根据原策划文件和真实拍摄复盘，生成一套“下一版可直接执行”的内容文件。

项目：${project.topic}
平台：${project.platform}
内容主体：${project.contentSubject}
内容领域：${project.contentDomain}
风格：${project.style}
目标用户：${project.targetAudience}

真实拍摄复盘：
${feedback}

项目策略（历次复盘沉淀）：
${strategy || "暂无历史策略"}

原策划文件：
${source}

输出要求：
- 只输出一个 JSON 对象，键名必须是：${FEEDBACK_REVISION_FILES.join("、")}。
- 四个文件必须互相一致：脚本里的每个段落都要能在分镜和成片执行稿里找到对应；拍摄清单必须覆盖新增、删减和补拍要求。
- 保留仍然有效的内容，只改动被现场证据支持的部分；不要为了“更完整”扩写无关内容。
- 删除拍摄中被证明不可执行的镜头或表达；新增镜头必须说明拍摄动作、时长和替代方案。
- 任何没有证据的效果、数据、用户反馈都不要补写。
${HUMAN_WRITING_RULES}

JSON 示例结构：{"03_口播脚本.md":"# 口播脚本\\n...","04_分镜与剪辑节奏.md":"# 分镜与剪辑节奏\\n...","05_拍摄清单.md":"# 拍摄清单\\n...","09_成片执行稿.md":"# 成片执行稿\\n..."}`;
}

export function buildFeedbackRevisionRepairPrompt(raw: string, errors: string[]): string {
  return `上一版“拍摄复盘修订包”不合格：${errors.join("；")}

请修复并只输出 JSON 对象，必须包含以下四个键：${FEEDBACK_REVISION_FILES.join("、")}。
每个值都是完整 Markdown，保留原有有效内容，不得出现占位语、泛泛而谈或无法拍摄的安排。
${HUMAN_WRITING_RULES}

待修复输出：
${raw}`;
}
