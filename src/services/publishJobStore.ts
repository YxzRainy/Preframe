/** 发布任务存储 — .piance/publish-jobs.json，原子写入 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type {
  PublishJob,
  PublishJobStatus,
  PublishMasterContent,
  PublishTarget,
  PublishTargetStatus,
} from "../types/publisher.js";

const FILE_NAME = "publish-jobs.json";

interface JobStoreData {
  jobs: PublishJob[];
}

const JOB_STATUSES: readonly PublishJobStatus[] = [
  "draft", "validating", "ready", "running", "partial", "completed", "failed", "cancelled",
];
const TARGET_STATUSES: readonly PublishTargetStatus[] = [
  "pending", "validating", "ready", "running", "success", "failed", "requires_login", "cancelled",
];

function isJobStatus(value: unknown): value is PublishJobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}
function isTargetStatus(value: unknown): value is PublishTargetStatus {
  return typeof value === "string" && (TARGET_STATUSES as readonly string[]).includes(value);
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v) : [];
}

function normalizeTarget(value: unknown): PublishTarget | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.accountId !== "string" || typeof rec.platform !== "string") return null;
  return {
    id: typeof rec.id === "string" ? rec.id : createId("tgt"),
    accountId: rec.accountId,
    platform: rec.platform as PublishTarget["platform"],
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: normalizeStringList(rec.tags),
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
    status: isTargetStatus(rec.status) ? rec.status : "pending",
    error: typeof rec.error === "string" ? rec.error : undefined,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

function normalizeJob(value: unknown): PublishJob | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.videoPath !== "string") return null;
  const master = (rec.masterContent && typeof rec.masterContent === "object" ? rec.masterContent : {}) as Record<string, unknown>;
  const masterContent: PublishMasterContent = {
    title: typeof master.title === "string" ? master.title : "",
    description: typeof master.description === "string" ? master.description : "",
    tags: normalizeStringList(master.tags),
  };
  const targets = Array.isArray(rec.targets) ? rec.targets.map(normalizeTarget).filter(Boolean) as PublishTarget[] : [];
  return {
    id: rec.id,
    projectSlug: typeof rec.projectSlug === "string" ? rec.projectSlug : undefined,
    videoPath: rec.videoPath,
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
    masterContent,
    status: isJobStatus(rec.status) ? rec.status : "draft",
    targets,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

async function readAll(): Promise<PublishJob[]> {
  const data = await readAtomicJson<JobStoreData>(FILE_NAME, { jobs: [] });
  const jobs = Array.isArray(data.jobs) ? data.jobs.map(normalizeJob).filter(Boolean) as PublishJob[] : [];
  return jobs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function writeAll(jobs: PublishJob[]): Promise<void> {
  await writeAtomicJson<JobStoreData>(FILE_NAME, { jobs });
}

export async function listJobs(): Promise<PublishJob[]> {
  return readAll();
}

export async function findJob(id: string): Promise<PublishJob | null> {
  const jobs = await readAll();
  return jobs.find((job) => job.id === id) ?? null;
}

export interface CreateJobInput {
  projectSlug?: string;
  videoPath: string;
  thumbnailPath?: string;
  masterContent: PublishMasterContent;
  targets: Array<Omit<PublishTarget, "id" | "status" | "updatedAt" | "error">>;
}

export async function createJob(input: CreateJobInput): Promise<PublishJob> {
  if (!input.videoPath.trim()) throw new Error("视频文件路径不能为空。");
  const now = nowIso();
  const job: PublishJob = {
    id: createId("job"),
    projectSlug: input.projectSlug?.trim() || undefined,
    videoPath: input.videoPath,
    thumbnailPath: input.thumbnailPath?.trim() || undefined,
    masterContent: input.masterContent,
    status: "draft",
    targets: input.targets.map((tgt) => ({
      ...tgt,
      id: createId("tgt"),
      status: "pending" as PublishTargetStatus,
      updatedAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  };
  const jobs = await readAll();
  await writeAll([job, ...jobs]);
  return job;
}

export interface UpdateJobInput {
  videoPath?: string;
  thumbnailPath?: string;
  masterContent?: PublishMasterContent;
  status?: PublishJobStatus;
  targets?: PublishTarget[];
}

export async function updateJob(id: string, input: UpdateJobInput): Promise<PublishJob> {
  const jobs = await readAll();
  const idx = jobs.findIndex((job) => job.id === id);
  if (idx === -1) throw new Error("发布任务不存在。");
  const current = jobs[idx];
  const next: PublishJob = {
    ...current,
    ...(typeof input.videoPath === "string" ? { videoPath: input.videoPath } : {}),
    ...(input.thumbnailPath !== undefined ? { thumbnailPath: input.thumbnailPath.trim() || undefined } : {}),
    ...(input.masterContent ? { masterContent: input.masterContent } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.targets ? { targets: input.targets } : {}),
    updatedAt: nowIso(),
  };
  jobs[idx] = next;
  await writeAll(jobs);
  return next;
}

/** 更新单个 target 状态（一个账号失败不影响其他账号） */
export async function updateTargetStatus(
  jobId: string,
  targetId: string,
  status: PublishTargetStatus,
  error?: string,
): Promise<PublishJob> {
  const jobs = await readAll();
  const idx = jobs.findIndex((job) => job.id === jobId);
  if (idx === -1) throw new Error("发布任务不存在。");
  const job = jobs[idx];
  const tIdx = job.targets.findIndex((t: PublishTarget) => t.id === targetId);
  if (tIdx === -1) throw new Error("发布目标不存在。");
  const now = nowIso();
  job.targets[tIdx] = {
    ...job.targets[tIdx],
    status,
    error: error || undefined,
    updatedAt: now,
  };
  // 聚合 job 状态
  job.status = aggregateJobStatus(job.targets);
  job.updatedAt = now;
  jobs[idx] = job;
  await writeAll(jobs);
  return job;
}

export function aggregateJobStatus(targets: PublishTarget[]): PublishJobStatus {
  if (targets.length === 0) return "draft";
  const statuses = targets.map((t) => t.status);
  if (statuses.every((s) => s === "success")) return "completed";
  if (statuses.some((s) => s === "running" || s === "validating")) return "running";
  if (statuses.every((s) => s === "success" || s === "failed" || s === "requires_login" || s === "cancelled")) {
    if (statuses.some((s) => s === "success") && statuses.some((s) => s === "failed" || s === "requires_login")) return "partial";
    if (statuses.every((s) => s === "failed" || s === "requires_login" || s === "cancelled")) return "failed";
  }
  if (statuses.every((s) => s === "ready")) return "ready";
  return "draft";
}

export async function deleteJob(id: string): Promise<void> {
  const jobs = await readAll();
  const next = jobs.filter((job) => job.id !== id);
  if (next.length === jobs.length) throw new Error("发布任务不存在。");
  await writeAll(next);
}
