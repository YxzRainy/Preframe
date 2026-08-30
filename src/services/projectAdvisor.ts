import { readProject } from "./projectReader.js";
import { readStage, type ProjectStage } from "./projectStage.js";
import { getLinksForProject } from "./shotAssetLinkStore.js";
import { listShootingFeedback } from "./shootingFeedback.js";
import type { ShotTask } from "../types/shotTask.js";

export type ProjectAdvicePriority = "blocking" | "high" | "normal";
export type ProjectAdviceTarget = "project" | "execution" | "document";

export interface ProjectAdvice {
  action: string;
  reason: string;
  ctaLabel: string;
  priority: ProjectAdvicePriority;
  target: ProjectAdviceTarget;
  documentFile?: string;
  evidence: string[];
}

export interface ProjectAdviceFacts {
  stage: ProjectStage;
  workflowVersion?: number;
  documentCompleted: number;
  documentTotal: number;
  invalidDocuments: Array<{ fileName: string; errors: string[] }>;
  shotTotal: number;
  shotCompleted: number;
  shotReady: number;
  missingAssets: number;
  suggestedAssets: number;
  assetHealthIssues: number;
  reshootCount: number;
  feedbackCount: number;
  publishRecordComplete: boolean;
  resumeAvailable: boolean;
  manualNextAction?: string;
}

function advice(
  action: string,
  reason: string,
  ctaLabel: string,
  priority: ProjectAdvicePriority,
  target: ProjectAdviceTarget,
  evidence: string[],
  documentFile?: string,
): ProjectAdvice {
  return { action, reason, ctaLabel, priority, target, evidence, ...(documentFile ? { documentFile } : {}) };
}

/**
 * 只选择当前最大的一个阻塞，不预排后续长链。
 * 排序原则：真源文档 > 补拍/素材异常 > 当前执行缺口 > 复盘 > 发布回填。
 */
export function buildProjectAdvice(facts: ProjectAdviceFacts): ProjectAdvice {
  const firstInvalid = facts.invalidDocuments[0];
  if (firstInvalid) {
    const topError = firstInvalid.errors[0] || "没有通过质量校验";
    return advice(
      `先修复 ${firstInvalid.fileName}`,
      `核心工作稿是后续拍摄和发布的真源；当前文档${topError}，继续向下推进会放大同一个问题。`,
      "查看并修复",
      "blocking",
      "document",
      [`${facts.documentCompleted}/${facts.documentTotal} 份核心工作稿可用`, topError],
      firstInvalid.fileName,
    );
  }

  if (facts.documentCompleted < facts.documentTotal) {
    const remaining = Math.max(1, facts.documentTotal - facts.documentCompleted);
    return advice(
      `补齐 ${remaining} 份核心工作稿`,
      "策划真源尚未完整，镜头、素材和发布文案还不能稳定复用同一口径。",
      "继续完成策划",
      "blocking",
      "project",
      [`${facts.documentCompleted}/${facts.documentTotal} 份核心工作稿可用`],
    );
  }

  if (facts.workflowVersion !== 2) {
    return advice(
      "先迁移到三文档工作流",
      "当前项目仍使用历史文档结构，继续修改会同时维护多份重复口径。",
      "查看迁移",
      "high",
      "project",
      ["项目仍使用历史工作流"],
    );
  }

  if (facts.reshootCount > 0) {
    return advice(
      `先处理 ${facts.reshootCount} 个需补拍镜头`,
      "最近一次现场复盘已经确认这些镜头不可直接进入剪辑，它们是当前最明确的交付阻塞。",
      "进入补拍",
      "blocking",
      "execution",
      [`${facts.reshootCount} 个镜头标记为需补拍`],
    );
  }

  if (facts.assetHealthIssues > 0) {
    return advice(
      `先修复 ${facts.assetHealthIssues} 个素材异常`,
      "已有素材路径失效、代理过期或文件不可用；不先修复，剪辑阶段会再次中断。",
      "检查素材",
      "blocking",
      "execution",
      [`${facts.assetHealthIssues} 个素材健康问题`],
    );
  }

  if (facts.shotTotal === 0) {
    return advice(
      "检查并生成镜头任务",
      "核心工作稿已经完整，但还没有可执行的镜头任务，项目暂时无法进入现场拍摄。",
      "进入拍摄准备",
      "high",
      "execution",
      ["核心工作稿已完整", "镜头任务为 0"],
    );
  }

  if ((facts.stage === "ready_to_shoot" || facts.stage === "planning") && facts.missingAssets > 0) {
    return advice(
      `先补齐 ${facts.missingAssets} 个镜头素材`,
      "拍摄尚未开始，先确认缺失素材和可替代画面，能避免现场临时改镜头。",
      "整理镜头素材",
      "high",
      "execution",
      [
        `${facts.missingAssets} 个镜头尚无确认素材`,
        ...(facts.suggestedAssets ? [`${facts.suggestedAssets} 个镜头已有候选素材`] : []),
      ],
    );
  }

  if (facts.shotCompleted < facts.shotTotal) {
    const pending = facts.shotTotal - facts.shotCompleted;
    return advice(
      `${facts.resumeAvailable ? "继续上次现场" : "完成"}剩余 ${pending} 个镜头`,
      "策划与镜头任务已经就绪，当前最大缺口是把未完成镜头变成可用素材。",
      facts.resumeAvailable ? "继续现场" : "开始拍摄",
      "high",
      "execution",
      [`${facts.shotCompleted}/${facts.shotTotal} 个镜头已完成`, `${facts.shotReady} 个镜头已具备拍摄条件`],
    );
  }

  if (facts.feedbackCount === 0) {
    return advice(
      "记录这次拍摄复盘",
      "镜头已经完成，但现场结果还没有被记录；现在复盘最容易保留真实问题和可复用经验。",
      "填写拍摄复盘",
      "high",
      "execution",
      [`${facts.shotCompleted}/${facts.shotTotal} 个镜头已完成`, "尚无拍摄复盘"],
    );
  }

  if (facts.stage === "ready_to_publish" && !facts.publishRecordComplete) {
    return advice(
      "回填实际发布信息",
      "项目已经到发布阶段，但发布时间、链接或真实数据仍未形成可复盘记录。",
      "打开发布与复盘",
      "high",
      "document",
      ["发布记录仍含“发布后填写”"],
      "03_发布与复盘.md",
    );
  }

  const manual = facts.manualNextAction?.trim();
  if (manual) {
    return advice(
      manual,
      "这是你为当前项目保留的明确下一步；系统未发现优先级更高的结构、素材或补拍阻塞。",
      "继续推进",
      "normal",
      "project",
      ["未发现更高优先级阻塞"],
    );
  }

  if (facts.stage === "editing") {
    return advice(
      "完成剪辑并核对最终口径",
      "镜头与拍摄复盘已经具备，当前应把素材收束成成片，并确认没有偏离锁稿版本。",
      "查看项目",
      "normal",
      "project",
      ["镜头已完成", "拍摄复盘已记录"],
    );
  }

  if (facts.stage === "archived") {
    return advice(
      "查看项目复盘与可复用经验",
      "项目已经归档，不再制造新的执行任务；优先确认哪些经验值得进入创作者学习层。",
      "查看归档项目",
      "normal",
      "project",
      ["项目已归档"],
    );
  }

  return advice(
    "核对发布卡并准备上线",
    "策划、镜头和现场复盘均已完成，当前没有更早阶段的阻塞。",
    "查看发布准备",
    "normal",
    "document",
    ["核心工作稿完整", "镜头已完成", "拍摄复盘已记录"],
    "03_发布与复盘.md",
  );
}

function publishRecordComplete(content: string): boolean {
  const section = content.match(/(?:^|\n)##\s+发布记录\s*\n([\s\S]*?)(?=\n##\s+|$)/u)?.[1] || "";
  if (!section.trim() || /发布后填写/u.test(section)) return false;
  return /https?:\/\//u.test(section) || /发布状态\s*[：:]\s*(?:已发布|已上线|完成)/u.test(section);
}

export async function getProjectAdviceContext(slug: string): Promise<{ advice: ProjectAdvice; facts: ProjectAdviceFacts }> {
  const [project, stage, links, feedback] = await Promise.all([
    readProject(slug),
    readStage(slug),
    getLinksForProject(slug),
    listShootingFeedback(slug),
  ]);
  const statuses = project.metadata.documentsStatus && typeof project.metadata.documentsStatus === "object" && !Array.isArray(project.metadata.documentsStatus)
    ? project.metadata.documentsStatus as Record<string, { generated?: boolean; status?: string; validationErrors?: string[]; fileName?: string }>
    : {};
  const documentTotal = project.metadata.workflowVersion === 2 ? 3 : Math.max(Object.keys(statuses).length, project.files.filter((file) => file.name.endsWith(".md")).length, 1);
  const documentCompleted = Object.values(statuses).filter((item) => item.generated || item.status === "completed").length;
  const invalidDocuments = project.files
    .filter((file): file is typeof file & { status: "failed"; validationErrors: string[] } => "status" in file && file.status === "failed")
    .map((file) => ({ fileName: file.name, errors: file.validationErrors || [] }));
  const tasks = Array.isArray(project.metadata.shotTasks) ? project.metadata.shotTasks as ShotTask[] : [];
  const confirmed = new Set(links.filter((link) => link.status === "confirmed").map((link) => link.shotTaskId));
  const suggested = new Set(links.filter((link) => link.status === "suggested").map((link) => link.shotTaskId));
  const latestFeedback = feedback[0];
  const reshootIds = new Set((latestFeedback?.shotRecords || []).filter((record) => record.outcome === "reshoot").map((record) => record.shotTaskId || `order:${record.order}`));
  const publishing = project.files.find((file) => file.name === "03_发布与复盘.md")?.content || "";

  const facts: ProjectAdviceFacts = {
    stage: stage.stage,
    workflowVersion: typeof project.metadata.workflowVersion === "number" ? project.metadata.workflowVersion : undefined,
    documentCompleted,
    documentTotal,
    invalidDocuments,
    shotTotal: tasks.length,
    shotCompleted: tasks.filter((task) => task.status === "done").length,
    shotReady: tasks.filter((task) => task.status === "ready" || task.status === "shot").length,
    missingAssets: tasks.filter((task) => !confirmed.has(task.id)).length,
    suggestedAssets: suggested.size,
    assetHealthIssues: 0,
    reshootCount: tasks.filter((task) => reshootIds.has(task.id) || reshootIds.has(`order:${task.order}`)).length,
    feedbackCount: feedback.length,
    publishRecordComplete: publishRecordComplete(publishing),
    resumeAvailable: Boolean(project.metadata.shootingSession && typeof project.metadata.shootingSession === "object"),
    manualNextAction: stage.nextAction,
  };
  return { facts, advice: buildProjectAdvice(facts) };
}

export async function getProjectAdvice(slug: string): Promise<ProjectAdvice> {
  return (await getProjectAdviceContext(slug)).advice;
}

export function projectAdviceHref(slug: string, advice: ProjectAdvice): string {
  const base = `/projects/${encodeURIComponent(slug)}`;
  if (advice.target === "execution") return `${base}?view=execution`;
  if (advice.target === "document" && advice.documentFile) return `${base}?file=${encodeURIComponent(advice.documentFile)}`;
  return base;
}
