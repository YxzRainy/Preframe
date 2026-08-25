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
