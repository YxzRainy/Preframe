/** 抖音半自动发布 Worker 进程状态存储 — .piance/publisher-processes.json
 *
 * 设计要点：
 * - 不使用纯内存状态作为唯一数据源；进程状态持久化到磁盘，进程异常退出/服务重启时可恢复会话
 * - 同一 Profile 同一时间只允许一个活跃进程（互斥）
 * - 不存储 Cookie/Token/Profile 内容，仅存进程元数据与阶段
 */

import { nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";

const FILE_NAME = "publisher-processes.json";

export type ProcessStage =
  | "launching"
  | "checking_login"
  | "waiting_login"
  | "uploading_video"
  | "filling_title"
  | "filling_description"
  | "filling_tags"
  | "uploading_cover"
  | "ready_for_confirmation"
  | "holding_done"
  | "cancelled"
  | "failed";

export type ProcessStatus = "running" | "done" | "failed" | "cancelled";

export interface PublisherProcessRecord {
  /** 业务进程 id（非 OS pid），用于跨重启关联 */
  id: string;
  sessionId: string;
  platform: string;
  profile: string;
  /** OS 进程 pid，用于取消；进程退出后保留以便排查 */
  pid?: number;
  stage: ProcessStage;
  status: ProcessStatus;
  /** 视频上传进度 0-100，无法读取时 null */
  progress?: number | null;
  /** 最近一次错误（不含敏感信息） */
  error?: string;
  videoPath: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

interface ProcessStoreData {
  processes: PublisherProcessRecord[];
}

function normalizeStage(value: unknown): ProcessStage | undefined {
  if (typeof value !== "string") return undefined;
  const valid: ProcessStage[] = [
    "launching",
    "checking_login",
    "waiting_login",
    "uploading_video",
    "filling_title",
    "filling_description",
    "filling_tags",
    "uploading_cover",
    "ready_for_confirmation",
    "holding_done",
    "cancelled",
    "failed",
  ];
  return (valid as readonly string[]).includes(value) ? (value as ProcessStage) : undefined;
}

function normalizeStatus(value: unknown): ProcessStatus {
  if (value === "done" || value === "failed" || value === "cancelled") return value;
  return "running";
}

function normalizeRecord(value: unknown): PublisherProcessRecord | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.sessionId !== "string") return null;
  const progress =
    typeof rec.progress === "number" ? rec.progress : rec.progress === null ? null : undefined;
  return {
    id: rec.id,
    sessionId: rec.sessionId,
    platform: typeof rec.platform === "string" ? rec.platform : "douyin",
    profile: typeof rec.profile === "string" ? rec.profile : "primary",
    pid: typeof rec.pid === "number" ? rec.pid : undefined,
    stage: normalizeStage(rec.stage) ?? "launching",
    status: normalizeStatus(rec.status),
    progress,
    error: typeof rec.error === "string" ? rec.error : undefined,
    videoPath: typeof rec.videoPath === "string" ? rec.videoPath : "",
    title: typeof rec.title === "string" ? rec.title : "",
    startedAt: typeof rec.startedAt === "string" ? rec.startedAt : nowIso(),
    finishedAt: typeof rec.finishedAt === "string" ? rec.finishedAt : undefined,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

async function readAll(): Promise<PublisherProcessRecord[]> {
  const data = await readAtomicJson<ProcessStoreData>(FILE_NAME, { processes: [] });
  const list = Array.isArray(data.processes)
    ? (data.processes.map(normalizeRecord).filter(Boolean) as PublisherProcessRecord[])
    : [];
  return list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

async function writeAll(processes: PublisherProcessRecord[]): Promise<void> {
  // 仅保留最近 50 条，避免无限增长
  const trimmed = processes.slice(0, 50);
  await writeAtomicJson<ProcessStoreData>(FILE_NAME, { processes: trimmed });
}

export interface CreateProcessInput {
  sessionId: string;
  platform: string;
  profile: string;
  videoPath: string;
  title: string;
}

export async function createProcess(input: CreateProcessInput): Promise<PublisherProcessRecord> {
  const list = await readAll();
  const now = nowIso();
  const record: PublisherProcessRecord = {
    id: `proc_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
    sessionId: input.sessionId,
    platform: input.platform,
    profile: input.profile,
    stage: "launching",
    status: "running",
    videoPath: input.videoPath,
    title: input.title,
    startedAt: now,
    updatedAt: now,
  };
  await writeAll([record, ...list]);
  return record;
}

export async function findProcess(id: string): Promise<PublisherProcessRecord | null> {
  const list = await readAll();
  return list.find((p) => p.id === id) ?? null;
}

export async function findProcessBySession(
  sessionId: string,
  platform: string,
): Promise<PublisherProcessRecord | null> {
  const list = await readAll();
  return list.find((p) => p.sessionId === sessionId && p.platform === platform) ?? null;
}

export async function listProcesses(): Promise<PublisherProcessRecord[]> {
  return readAll();
}

export async function listActiveProcesses(): Promise<PublisherProcessRecord[]> {
  const list = await readAll();
  return list.filter((p) => p.status === "running");
}

/** 同一 profile 是否已有活跃进程（互斥） */
export async function findActiveByProfile(
  platform: string,
  profile: string,
): Promise<PublisherProcessRecord | null> {
  const list = await readAll();
  return (
    list.find((p) => p.platform === platform && p.profile === profile && p.status === "running") ?? null
  );
}

export interface UpdateProcessInput {
  pid?: number;
  stage?: ProcessStage;
  status?: ProcessStatus;
  progress?: number | null;
  error?: string;
  finishedAt?: string;
}

export async function updateProcess(
  id: string,
  patch: UpdateProcessInput,
): Promise<PublisherProcessRecord> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("进程记录不存在。");
  const next: PublisherProcessRecord = {
    ...list[idx],
    ...(typeof patch.pid === "number" ? { pid: patch.pid } : {}),
    ...(patch.stage ? { stage: patch.stage } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(typeof patch.error === "string" ? { error: patch.error } : {}),
    ...(patch.finishedAt ? { finishedAt: patch.finishedAt } : {}),
    updatedAt: nowIso(),
  };
  list[idx] = next;
  await writeAll(list);
  return next;
}

/** 标记进程结束（成功完成 holding 阶段退出） */
export async function markDone(id: string): Promise<void> {
  await updateProcess(id, { status: "done", finishedAt: nowIso() });
}

/** 标记进程失败 */
export async function markFailed(id: string, error: string): Promise<void> {
  await updateProcess(id, { status: "failed", error, finishedAt: nowIso() });
}

/** 标记进程已取消 */
export async function markCancelled(id: string): Promise<void> {
  await updateProcess(id, { status: "cancelled", finishedAt: nowIso() });
}

/**
 * 启动时恢复：将所有仍标记为 running 但实际无对应 OS 进程的记录标为 failed。
 * 由 Preframe 服务启动时调用一次，防止内存状态丢失后误判。
 */
export async function reconcileOnStartup(getActivePids: () => Set<number>): Promise<void> {
  const list = await readAll();
  let changed = false;
  const activePids = getActivePids();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.status !== "running") continue;
    // pid 不在活跃集合中 → 进程已死，标记失败
    if (p.pid !== undefined && !activePids.has(p.pid)) {
      list[i] = {
        ...p,
        status: "failed",
        error: p.error || "进程异常退出（服务重启时检测到）",
        finishedAt: nowIso(),
        updatedAt: nowIso(),
      };
      changed = true;
    }
  }
  if (changed) await writeAll(list);
}
