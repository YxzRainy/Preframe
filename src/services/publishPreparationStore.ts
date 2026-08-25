/** 发布准备存储 — .piance/publish-preparations.json，原子写入
 * 无账号门禁：任务按平台创建，不绑定 PublisherAccount。 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import { updatePublishData } from "./projectStage.js";
import {
  PUBLISHER_PLATFORM_LABELS,
  type PublisherPlatform,
  PublishDraftTarget,
  PublishPreparation,
  PublishPreparationMaster,
  PublishPreparationStatus,
} from "../types/publisher.js";

const FILE_NAME = "publish-preparations.json";

interface PreparationStoreData {
  preparations: PublishPreparation[];
}

const STATUSES: readonly PublishPreparationStatus[] = [
  "draft", "checking", "ready", "exported", "manually_published", "archived",
];
const PREP_PLATFORMS: readonly string[] = [
  "douyin", "xiaohongshu", "bilibili", "tencent", "kuaishou", "youtube",
];

function isStatus(value: unknown): value is PublishPreparationStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && PREP_PLATFORMS.includes(value);
}
function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v) : [];
}

function normalizeTarget(value: unknown): PublishDraftTarget | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (!isPlatform(rec.platform)) return null;
  return {
    id: typeof rec.id === "string" ? rec.id : createId("dtgt"),
    platform: rec.platform,
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: normalizeStringList(rec.tags),
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
    enabled: typeof rec.enabled === "boolean" ? rec.enabled : true,
    validationErrors: normalizeStringList(rec.validationErrors),
    manuallyPublished: typeof rec.manuallyPublished === "boolean" ? rec.manuallyPublished : undefined,
    manuallyPublishedAt: typeof rec.manuallyPublishedAt === "string" ? rec.manuallyPublishedAt : undefined,
    publishResult: rec.publishResult === "published" || rec.publishResult === "failed" ? rec.publishResult : undefined,
    publishUrl: typeof rec.publishUrl === "string" ? rec.publishUrl : undefined,
    publishNote: typeof rec.publishNote === "string" ? rec.publishNote : undefined,
  };
}

function normalizeMaster(value: unknown): PublishPreparationMaster {
  const rec = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: normalizeStringList(rec.tags),
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
  };
}

function normalizePreparation(value: unknown): PublishPreparation | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.videoPath !== "string") return null;
  const targets = Array.isArray(rec.targets) ? rec.targets.map(normalizeTarget).filter(Boolean) as PublishDraftTarget[] : [];
  return {
    id: rec.id,
    projectSlug: typeof rec.projectSlug === "string" ? rec.projectSlug : undefined,
    videoPath: rec.videoPath,
    masterContent: normalizeMaster(rec.masterContent),
    targets,
    status: isStatus(rec.status) ? rec.status : "draft",
    exportDir: typeof rec.exportDir === "string" ? rec.exportDir : undefined,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

async function readAll(): Promise<PublishPreparation[]> {
  const data = await readAtomicJson<PreparationStoreData>(FILE_NAME, { preparations: [] });
  const list = Array.isArray(data.preparations) ? data.preparations.map(normalizePreparation).filter(Boolean) as PublishPreparation[] : [];
  return list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function writeAll(preparations: PublishPreparation[]): Promise<void> {
  await writeAtomicJson<PreparationStoreData>(FILE_NAME, { preparations });
}

export async function listPreparations(): Promise<PublishPreparation[]> {
  return readAll();
}

export async function findPreparation(id: string): Promise<PublishPreparation | null> {
  const list = await readAll();
  return list.find((p) => p.id === id) ?? null;
}

export interface CreatePreparationInput {
  projectSlug?: string;
  videoPath: string;
  masterContent: PublishPreparationMaster;
  targets: Array<Omit<PublishDraftTarget, "id" | "validationErrors" | "manuallyPublished" | "manuallyPublishedAt" | "publishResult" | "publishUrl" | "publishNote">>;
}

export async function createPreparation(input: CreatePreparationInput): Promise<PublishPreparation> {
  if (!input.videoPath.trim()) throw new Error("视频文件路径不能为空。");
  const now = nowIso();
  const prep: PublishPreparation = {
    id: createId("prep"),
    projectSlug: input.projectSlug?.trim() || undefined,
    videoPath: input.videoPath,
    masterContent: input.masterContent,
    status: "draft",
    targets: input.targets.map((t) => ({
      ...t,
      id: createId("dtgt"),
      validationErrors: [],
    })),
    createdAt: now,
    updatedAt: now,
  };
  const list = await readAll();
  await writeAll([prep, ...list]);
  return prep;
}

export interface UpdatePreparationInput {
  videoPath?: string;
  masterContent?: PublishPreparationMaster;
  status?: PublishPreparationStatus;
  targets?: PublishDraftTarget[];
  exportDir?: string;
}

export async function updatePreparation(id: string, input: UpdatePreparationInput): Promise<PublishPreparation> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("发布准备任务不存在。");
  const current = list[idx];
  const next: PublishPreparation = {
    ...current,
    ...(typeof input.videoPath === "string" ? { videoPath: input.videoPath } : {}),
    ...(input.masterContent ? { masterContent: input.masterContent } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.targets ? { targets: input.targets } : {}),
    ...(typeof input.exportDir === "string" ? { exportDir: input.exportDir } : {}),
    updatedAt: nowIso(),
  };
  list[idx] = next;
  await writeAll(list);
  return next;
}

/** 更新单个 target（独立编辑各平台文案） */
export async function updateTarget(
  preparationId: string,
  targetId: string,
  patch: Partial<Pick<PublishDraftTarget, "title" | "description" | "tags" | "thumbnailPath" | "enabled" | "validationErrors" | "publishResult" | "publishUrl" | "publishNote">>,
): Promise<PublishPreparation> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === preparationId);
  if (idx === -1) throw new Error("发布准备任务不存在。");
  const prep = list[idx];
  const tIdx = prep.targets.findIndex((t) => t.id === targetId);
  if (tIdx === -1) throw new Error("发布目标不存在。");
  prep.targets[tIdx] = { ...prep.targets[tIdx], ...patch };
  prep.updatedAt = nowIso();
  list[idx] = prep;
  await writeAll(list);
  return prep;
}

/** 手动标记某平台已发布（不伪装系统检测） */
export async function markTargetManuallyPublished(
  preparationId: string,
  targetId: string,
  published: boolean,
  details: { result?: "published" | "failed"; publishUrl?: string; publishNote?: string } = {},
): Promise<PublishPreparation> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === preparationId);
  if (idx === -1) throw new Error("发布准备任务不存在。");
  const prep = list[idx];
  const tIdx = prep.targets.findIndex((t) => t.id === targetId);
  if (tIdx === -1) throw new Error("发布目标不存在。");
  prep.targets[tIdx] = {
    ...prep.targets[tIdx],
    manuallyPublished: published,
    manuallyPublishedAt: published ? nowIso() : undefined,
    publishResult: details.result || (published ? "published" : undefined),
    publishUrl: details.publishUrl?.trim() || undefined,
    publishNote: details.publishNote?.trim() || undefined,
  };
  // 若所有启用目标都已手动发布，则整体标记为 manually_published
  const enabled = prep.targets.filter((t) => t.enabled);
  if (enabled.length > 0 && enabled.every((t) => t.manuallyPublished)) {
    prep.status = "manually_published";
  } else if (prep.status === "manually_published") {
    prep.status = "exported";
  }
  prep.updatedAt = nowIso();
  list[idx] = prep;
  await writeAll(list);
  if (published && prep.projectSlug) {
    await updatePublishData(prep.projectSlug, {
      platform: PUBLISHER_PLATFORM_LABELS[prep.targets[tIdx].platform],
      publishedAt: prep.targets[tIdx].manuallyPublishedAt,
      publishUrl: prep.targets[tIdx].publishUrl,
    });
  }
  return prep;
}

export async function deletePreparation(id: string): Promise<void> {
  const list = await readAll();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) throw new Error("发布准备任务不存在。");
  await writeAll(next);
}
