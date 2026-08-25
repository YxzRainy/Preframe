import { stat } from "node:fs/promises";
import { readProject } from "./projectReader.js";
import { readStage, defaultNextAction } from "./projectStage.js";
import { getLinksForProject } from "./shotAssetLinkStore.js";
import { listPreparations } from "./publishPreparationStore.js";
import { checkPreparation } from "./publishPreparationCheck.js";
import { readEditingManifest } from "./editingPrepBuilder.js";
import { listShootingFeedback } from "./shootingFeedback.js";
import type { ShotTask } from "../types/shotTask.js";
import type { EditingManifest } from "../types/editingManifest.js";

export interface ProjectCockpit {
  stage: Awaited<ReturnType<typeof readStage>>;
  nextAction: string;
  documents: { completed: number; total: number; label: string; tone: "ready" | "warning" | "muted" };
  shots: { completed: number; total: number; label: string; tone: "ready" | "warning" | "muted" };
  assets: { ready: number; total: number; suggested: number; missing: number; healthIssues: number; reshoot: number; label: string; tone: "ready" | "warning" | "muted" };
  publishing: { label: string; detail: string; tone: "ready" | "warning" | "muted" };
}

async function countAssetHealthIssues(manifest: EditingManifest | null): Promise<number> {
  if (!manifest) return 0;
  const issueFlags = await Promise.all(manifest.entries.map(async (entry) => {
    if (entry.proxyStale || !entry.symlinkOk) return true;
    try {
      const info = await stat(entry.originalPath);
      return !info.isFile() || info.size === 0;
    } catch {
      return true;
    }
  }));
  return issueFlags.filter(Boolean).length;
}

export async function getProjectCockpit(slug: string): Promise<ProjectCockpit> {
  const [project, stage, links, preparations, manifest, feedback] = await Promise.all([
    readProject(slug),
    readStage(slug),
    getLinksForProject(slug),
    listPreparations(),
    readEditingManifest(slug),
    listShootingFeedback(slug),
  ]);
  const statuses = project.metadata.documentsStatus && typeof project.metadata.documentsStatus === "object"
    ? Object.values(project.metadata.documentsStatus as Record<string, { generated?: boolean; status?: string }>)
    : [];
  const documentTotal = 10;
  const documentCompleted = statuses.filter((item) => item.generated || item.status === "completed").length;
  const shotTasks = Array.isArray(project.metadata.shotTasks) ? project.metadata.shotTasks as ShotTask[] : [];
  const shotCompleted = shotTasks.filter((task) => task.status === "done").length;
  const confirmedShots = new Set(links.filter((link) => link.status === "confirmed").map((link) => link.shotTaskId));
  const suggestedShots = new Set(links.filter((link) => link.status === "suggested").map((link) => link.shotTaskId));
  const missingAssets = shotTasks.filter((task) => !confirmedShots.has(task.id)).length;
  const latestFeedback = feedback[0];
  const reshootShots = new Set((latestFeedback?.shotRecords || [])
    .filter((record) => record.outcome === "reshoot")
    .map((record) => record.shotTaskId || `order:${record.order}`));
  const reshootCount = shotTasks.filter((task) => reshootShots.has(task.id) || reshootShots.has(`order:${task.order}`)).length;
  const healthIssues = await countAssetHealthIssues(manifest);
  const preparation = preparations.find((item) => item.projectSlug === slug);
  const check = preparation ? await checkPreparation(preparation) : undefined;
  const publishing = !preparation
    ? { label: "未开始", detail: "尚未创建发布准备", tone: "muted" as const }
    : preparation.status === "exported" || preparation.status === "manually_published"
      ? { label: preparation.status === "manually_published" ? "已记录发布" : "发布包已导出", detail: `${preparation.targets.filter((target) => target.enabled).length} 个平台`, tone: "ready" as const }
      : check?.level === "ready"
        ? { label: "可以发布", detail: "视频与平台文案检查通过", tone: "ready" as const }
        : { label: check?.level === "blocked" ? "存在缺失项" : "需要确认", detail: check?.videoExists ? "检查平台文案与封面" : "缺少可用成片", tone: "warning" as const };

  return {
    stage,
    nextAction: stage.nextAction?.trim() || defaultNextAction(stage.stage),
    documents: {
      completed: documentCompleted,
      total: documentTotal,
      label: documentCompleted === documentTotal ? "策划包完整" : `${documentTotal - documentCompleted} 份待处理`,
      tone: documentCompleted === documentTotal ? "ready" : documentCompleted ? "warning" : "muted",
    },
    shots: {
      completed: shotCompleted,
      total: shotTasks.length,
      label: shotTasks.length === 0 ? "尚未生成任务" : shotCompleted === shotTasks.length ? "镜头已完成" : `${shotTasks.length - shotCompleted} 个待执行`,
      tone: shotTasks.length > 0 && shotCompleted === shotTasks.length ? "ready" : shotTasks.length ? "warning" : "muted",
    },
    assets: {
      ready: confirmedShots.size,
      total: shotTasks.length,
      suggested: suggestedShots.size,
      missing: missingAssets,
      healthIssues,
      reshoot: reshootCount,
      label: shotTasks.length === 0
        ? "等待镜头任务"
        : missingAssets === 0 && healthIssues === 0 && reshootCount === 0
          ? "素材已匹配"
          : [
              missingAssets ? `${missingAssets} 缺素材` : "",
              healthIssues ? `${healthIssues} 素材异常` : "",
              reshootCount ? `${reshootCount} 需补拍` : "",
            ].filter(Boolean).join(" · "),
      tone: shotTasks.length > 0 && missingAssets === 0 && healthIssues === 0 && reshootCount === 0 ? "ready" : shotTasks.length ? "warning" : "muted",
    },
    publishing,
  };
}
