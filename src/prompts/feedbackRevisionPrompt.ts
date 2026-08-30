import { HUMAN_WRITING_RULES } from "./humanWritingRules.js";

export const FEEDBACK_REVISION_FILES = ["02_拍摄执行稿.md"] as const;

export function buildFeedbackRevisionPrompt(
  project: { topic: string; platform: string; contentSubject: string; contentDomain: string; style: string; targetAudience: string },
  documents: Array<{ name: string; content: string }>,
  feedback: string,
  strategy = "",
): string {
  const source = documents.map((doc) => `===== ${doc.name} =====\n${doc.content.trim()}`).join("\n\n");
  return `你是短视频现场编导。请根据真实拍摄复盘，直接修订唯一真源“02_拍摄执行稿.md”。

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

当前创作简报与拍摄执行稿：
${source}

输出要求：
- 只输出一个 JSON 对象，唯一键名是“02_拍摄执行稿.md”。
- 直接把复盘中已被证实的问题修进最终逐字稿、镜头执行表、素材和风险，不再生成四份互相同步的修订文档。
- 镜头执行表仍使用“时间｜最终口播｜画面/动作｜字幕重点｜B-roll/素材｜拍摄状态”，新增或需补拍的状态写“未拍”。
- 保留仍然有效的内容，只改动被现场证据支持的部分；删除被证明不可执行的镜头或表达。
- 不得留下“用户后续再压缩/再修改”的任务；修订后必须可直接进入下一轮拍摄。
${HUMAN_WRITING_RULES}

JSON 示例：{"02_拍摄执行稿.md":"# 拍摄执行稿\\n..."}`;
}

export function buildFeedbackRevisionRepairPrompt(raw: string, errors: string[]): string {
  return `上一版拍摄执行稿修订不合格：${errors.join("；")}

请修复并只输出 JSON 对象，唯一键名是“02_拍摄执行稿.md”。值为完整 Markdown，不得出现占位语、泛泛而谈或无法拍摄的安排。
${HUMAN_WRITING_RULES}

待修复输出：
${raw}`;
}
