/** 项目阶段系统 — 真实阶段管理与旧项目兼容推断 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectDirectory } from "./projectManager.js";
import { writeJsonAtomicPath } from "./atomicJson.js";

export type ProjectStage =
  | "idea"
  | "planning"
  | "ready_to_shoot"
  | "shooting"
  | "editing"
  | "ready_to_publish"
  | "published"
  | "archived";

export const PROJECT_STAGE_ORDER: ProjectStage[] = [
  "idea",
  "planning",
  "ready_to_shoot",
  "shooting",
  "editing",
  "ready_to_publish",
  "published",
  "archived",
];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  idea: "灵感",
  planning: "策划中",
  ready_to_shoot: "待拍摄",
  shooting: "拍摄中",
  editing: "剪辑中",
  ready_to_publish: "待发布",
  published: "已发布",
  archived: "已归档",
};

export const PROJECT_STAGE_COLORS: Record<ProjectStage, string> = {
  idea: "var(--text-tertiary)",
  planning: "var(--accent)",
  ready_to_shoot: "var(--warning)",
  shooting: "var(--warning)",
  editing: "#c084fc",
  ready_to_publish: "#38bdf8",
  published: "var(--success)",
  archived: "var(--text-muted)",
};

export interface StageContext {
  stage: ProjectStage;
  stageUpdatedAt: string;
  nextAction?: string;
}

export interface PublishData {
  platform?: string;
  publishUrl?: string;
  publishedAt?: string;
  views?: number;
  likes?: number;
  favorites?: number;
  comments?: number;
  completionRate?: number;
  reviewNote?: string;
  nextTopic?: string;
}

function isStage(value: unknown): value is ProjectStage {
  return typeof value === "string" && (PROJECT_STAGE_ORDER as string[]).includes(value);
}

async function readProjectJson(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function writeProjectJson(projectDir: string, data: Record<string, unknown>): Promise<void> {
  await writeJsonAtomicPath(path.join(projectDir, "project.json"), data);
}

/**
 * 根据已有 metadata 推断默认阶段：
 * - 已有 publishData 且 publishedAt → published
 * - shotTasks 全部 done → editing
 * - shotTasks 存在 shot/ready → shooting
 * - 10 文档完成 → ready_to_shoot
 * - 文档部分完成 → planning
 * - 其余 → idea
 */
export function inferStage(metadata: Record<string, unknown>): ProjectStage {
  const publishData = metadata.publishData;
  if (publishData && typeof publishData === "object" && !Array.isArray(publishData)) {
    const pd = publishData as Record<string, unknown>;
    if (typeof pd.publishedAt === "string" && pd.publishedAt.trim()) return "published";
  }
  const shotTasks = metadata.shotTasks;
  if (Array.isArray(shotTasks) && shotTasks.length > 0) {
    const statuses = (shotTasks as Array<{ status?: string }>).map((t) => t.status);
    const allDone = statuses.every((s) => s === "done");
    if (allDone) return "editing";
    if (statuses.some((s) => s === "shot" || s === "ready")) return "shooting";
  }
  const generated = metadata.generated;
  const completedCount = Array.isArray(generated) ? generated.filter((v) => typeof v === "string").length : 0;
  const status = metadata.status;
  if (status === "complete" || completedCount >= 10) return "ready_to_shoot";
  if (completedCount > 0) return "planning";
  return "idea";
}

export async function readStage(slug: string): Promise<StageContext> {
  const projectDir = resolveProjectDirectory(slug);
  const metadata = await readProjectJson(projectDir);
  const stage = isStage(metadata.stage) ? metadata.stage : inferStage(metadata);
  const stageUpdatedAt = typeof metadata.stageUpdatedAt === "string" ? metadata.stageUpdatedAt : new Date().toISOString();
  const nextAction = typeof metadata.nextAction === "string" ? metadata.nextAction : undefined;
  if (!isStage(metadata.stage)) {
    await writeProjectJson(projectDir, { ...metadata, stage, stageUpdatedAt, nextAction });
  }
  return { stage, stageUpdatedAt, nextAction };
}

export async function updateStage(slug: string, stage: ProjectStage, nextAction?: string): Promise<StageContext> {
  if (!isStage(stage)) throw new Error(`无效阶段：${stage}`);
  const projectDir = resolveProjectDirectory(slug);
  const metadata = await readProjectJson(projectDir);
  const stageUpdatedAt = new Date().toISOString();
  const next = nextAction !== undefined ? nextAction : metadata.nextAction;
  const updated: Record<string, unknown> = {
    ...metadata,
    stage,
    stageUpdatedAt,
    ...(nextAction !== undefined ? { nextAction: nextAction || undefined } : {}),
  };
  await writeProjectJson(projectDir, updated);
  return { stage, stageUpdatedAt, nextAction: typeof next === "string" ? next : undefined };
}

export async function readPublishData(slug: string): Promise<PublishData> {
  const projectDir = resolveProjectDirectory(slug);
  const metadata = await readProjectJson(projectDir);
  const pd = metadata.publishData;
  if (pd && typeof pd === "object" && !Array.isArray(pd)) return pd as PublishData;
  return {};
}

export async function updatePublishData(slug: string, data: PublishData): Promise<PublishData> {
  const projectDir = resolveProjectDirectory(slug);
  const metadata = await readProjectJson(projectDir);
  const merged: PublishData = {
    ...(metadata.publishData && typeof metadata.publishData === "object" && !Array.isArray(metadata.publishData) ? metadata.publishData as PublishData : {}),
    ...data,
  };
  const stageUpdatedAt = new Date().toISOString();
  // 录入发布时间后自动推进到 published
  const stage: ProjectStage = merged.publishedAt ? "published" : isStage(metadata.stage) ? metadata.stage : inferStage(metadata);
  const updated: Record<string, unknown> = { ...metadata, publishData: merged, stage, stageUpdatedAt };
  await writeProjectJson(projectDir, updated);
  return merged;
}

export interface ProjectStageSummary {
  slug: string;
  name: string;
  platform: string;
  stage: ProjectStage;
  stageLabel: string;
  stageColor: string;
  stageUpdatedAt: string;
  nextAction?: string;
  documentCompleted: number;
  documentTotal: number;
  shotCompleted: number;
  shotTotal: number;
  assetReadyRatio: string;
  updatedAt: string;
}

/** 阶段下一步动作的默认提示 */
export function defaultNextAction(stage: ProjectStage): string {
  switch (stage) {
    case "idea": return "把灵感转化为选题并生成策划文档";
    case "planning": return "继续完善策划文档，确认后进入拍摄准备";
    case "ready_to_shoot": return "核对镜头任务与素材，开始拍摄";
    case "shooting": return "推进镜头拍摄，标记完成状态";
    case "editing": return "进入剪辑阶段，整理素材与节奏";
    case "ready_to_publish": return "录入发布信息，准备上线";
    case "published": return "录入数据复盘，沉淀经验";
    case "archived": return "项目已归档";
  }
}
