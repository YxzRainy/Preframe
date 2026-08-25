/** 发布会话存储 — .piance/publish-sessions.json，原子写入 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type {
  AssistedPublishStatus,
  CoverCandidate,
  PublishReadiness,
  PublishSession,
  PublishSessionStatus,
  PublishSessionTarget,
  PublishSessionTargetStatus,
  TargetContentSource,
  UsageEvent,
  UsageLogEntry,
} from "../types/publishSession.js";
import type { PublisherPlatform } from "../types/publisher.js";

const FILE_NAME = "publish-sessions.json";

interface SessionStoreData {
  sessions: PublishSession[];
}

const STATUSES: readonly PublishSessionStatus[] = ["ready", "running", "paused", "completed", "archived"];
const TARGET_STATUSES: readonly PublishSessionTargetStatus[] = ["pending", "opened", "published", "skipped"];
const ASSISTED_STATUSES: readonly AssistedPublishStatus[] = [
  "pending",
  "launching",
  "waiting_login",
  "uploading",
  "filling",
  "ready_for_confirmation",
  "confirmed",
  "failed",
  "cancelled",
];
const PLATFORMS: readonly string[] = ["douyin", "xiaohongshu", "bilibili", "tencent", "kuaishou", "youtube"];

function isStatus(value: unknown): value is PublishSessionStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
function isTargetStatus(value: unknown): value is PublishSessionTargetStatus {
  return typeof value === "string" && (TARGET_STATUSES as readonly string[]).includes(value);
}
function isAssistedStatus(value: unknown): value is AssistedPublishStatus {
  return typeof value === "string" && (ASSISTED_STATUSES as readonly string[]).includes(value);
}
function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && PLATFORMS.includes(value);
}
function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeTarget(value: unknown): PublishSessionTarget | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (!isPlatform(rec.platform)) return null;
  const assistedProgress =
    typeof rec.assistedProgress === "number"
      ? rec.assistedProgress
      : rec.assistedProgress === null
        ? null
        : undefined;
  return {
    platform: rec.platform,
    title: typeof rec.title === "string" ? rec.title : "",
    description: typeof rec.description === "string" ? rec.description : "",
    tags: normalizeStringList(rec.tags),
    thumbnailPath: typeof rec.thumbnailPath === "string" ? rec.thumbnailPath : undefined,
    status: isTargetStatus(rec.status) ? rec.status : "pending",
    openedAt: typeof rec.openedAt === "string" ? rec.openedAt : undefined,
    publishedAt: typeof rec.publishedAt === "string" ? rec.publishedAt : undefined,
    assistedStatus: isAssistedStatus(rec.assistedStatus) ? rec.assistedStatus : undefined,
    assistedError: typeof rec.assistedError === "string" ? rec.assistedError : undefined,
    assistedProgress,
    assistedProcessId: typeof rec.assistedProcessId === "string" ? rec.assistedProcessId : undefined,
    assistedUpdatedAt: typeof rec.assistedUpdatedAt === "string" ? rec.assistedUpdatedAt : undefined,
    source: normalizeSource(rec.source),
    adapted: typeof rec.adapted === "boolean" ? rec.adapted : undefined,
  };
}

function normalizeSource(value: unknown): TargetContentSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.title !== "string" || typeof rec.description !== "string" || typeof rec.tags !== "string") {
    return undefined;
  }
  return { title: rec.title, description: rec.description, tags: rec.tags };
}

function normalizeCoverCandidate(value: unknown): CoverCandidate | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.path !== "string" || typeof rec.score !== "number") return null;
  return {
    path: rec.path,
    score: rec.score,
    reasons: normalizeStringList(rec.reasons),
  };
}

function normalizeUsageLog(value: unknown): UsageLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v): UsageLogEntry | null => {
      if (!v || typeof v !== "object") return null;
      const rec = v as Record<string, unknown>;
      if (typeof rec.event !== "string" || typeof rec.at !== "string") return null;
      const validEvents: UsageEvent[] = [
        "session_started",
        "cover_chosen",
        "target_edited",
        "target_adapted",
        "target_adapt_reverted",
        "target_skipped",
        "target_published",
      ];
      if (!(validEvents as readonly string[]).includes(rec.event)) return null;
      return {
        event: rec.event as UsageEvent,
        platform: isPlatform(rec.platform) ? rec.platform : undefined,
        detail: typeof rec.detail === "string" ? rec.detail : undefined,
        at: rec.at,
      };
    })
    .filter(Boolean) as UsageLogEntry[];
}

function normalizeSession(value: unknown): PublishSession | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.videoPath !== "string") return null;
  const targets = Array.isArray(rec.targets) ? rec.targets.map(normalizeTarget).filter(Boolean) as PublishSessionTarget[] : [];
  const coverCandidates = Array.isArray(rec.coverCandidates)
    ? (rec.coverCandidates.map(normalizeCoverCandidate).filter(Boolean) as CoverCandidate[])
    : undefined;
  return {
    id: rec.id,
    videoPath: rec.videoPath,
    projectSlug: typeof rec.projectSlug === "string" ? rec.projectSlug : undefined,
    projectName: typeof rec.projectName === "string" ? rec.projectName : undefined,
    currentIndex: typeof rec.currentIndex === "number" ? rec.currentIndex : 0,
    status: isStatus(rec.status) ? rec.status : "ready",
    targets,
    firstPublishedAt: typeof rec.firstPublishedAt === "string" ? rec.firstPublishedAt : undefined,
    precheckSummary: typeof rec.precheckSummary === "string" ? rec.precheckSummary : undefined,
    coverCandidates,
    readiness: typeof rec.readiness === "object" && rec.readiness ? (rec.readiness as PublishReadiness) : undefined,
    usageLog: normalizeUsageLog(rec.usageLog),
    originalSnapshot:
      rec.originalSnapshot && typeof rec.originalSnapshot === "object"
        ? (rec.originalSnapshot as Record<string, { title: string; description: string; tags: string[] }>)
        : undefined,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

async function readAll(): Promise<PublishSession[]> {
  const data = await readAtomicJson<SessionStoreData>(FILE_NAME, { sessions: [] });
  const sessions = Array.isArray(data.sessions) ? data.sessions.map(normalizeSession).filter(Boolean) as PublishSession[] : [];
  return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function writeAll(sessions: PublishSession[]): Promise<void> {
  await writeAtomicJson<SessionStoreData>(FILE_NAME, { sessions });
}

export async function listSessions(): Promise<PublishSession[]> {
  return readAll();
}

export async function findSession(id: string): Promise<PublishSession | null> {
  const list = await readAll();
  return list.find((s) => s.id === id) ?? null;
}

export interface CreateSessionInput {
  videoPath: string;
  projectSlug?: string;
  projectName?: string;
  targets: PublishSessionTarget[];
  precheckSummary?: string;
  coverCandidates?: CoverCandidate[];
  readiness?: PublishReadiness;
  originalSnapshot?: Record<string, { title: string; description: string; tags: string[] }>;
}

export async function createSession(input: CreateSessionInput): Promise<PublishSession> {
  if (!input.videoPath.trim()) throw new Error("视频文件路径不能为空。");
  if (input.targets.length === 0) throw new Error("至少需要一个发布平台。");
  const now = nowIso();
  const session: PublishSession = {
    id: createId("sess"),
    videoPath: input.videoPath,
    projectSlug: input.projectSlug,
    projectName: input.projectName,
    currentIndex: 0,
    status: "ready",
    targets: input.targets,
    precheckSummary: input.precheckSummary,
    coverCandidates: input.coverCandidates,
    readiness: input.readiness,
    originalSnapshot: input.originalSnapshot,
    usageLog: [{ event: "session_started", at: now }],
    createdAt: now,
    updatedAt: now,
  };
  const list = await readAll();
  await writeAll([session, ...list]);
  return session;
}

export interface UpdateSessionInput {
  status?: PublishSessionStatus;
  currentIndex?: number;
  targets?: PublishSessionTarget[];
  firstPublishedAt?: string;
}

export async function updateSession(id: string, input: UpdateSessionInput): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("发布会话不存在。");
  const current = list[idx];
  const next: PublishSession = {
    ...current,
    ...(input.status ? { status: input.status } : {}),
    ...(typeof input.currentIndex === "number" ? { currentIndex: input.currentIndex } : {}),
    ...(input.targets ? { targets: input.targets } : {}),
    ...(typeof input.firstPublishedAt === "string" ? { firstPublishedAt: input.firstPublishedAt } : {}),
    updatedAt: nowIso(),
  };
  list[idx] = next;
  await writeAll(list);
  return next;
}

/** 更新单个 target 状态 */
export async function updateTargetStatus(
  sessionId: string,
  platform: PublisherPlatform,
  patch: Partial<Pick<PublishSessionTarget, "status" | "title" | "description" | "tags" | "thumbnailPath" | "openedAt" | "publishedAt">>,
): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  const session = list[idx];
  const tIdx = session.targets.findIndex((t) => t.platform === platform);
  if (tIdx === -1) throw new Error("发布目标不存在。");
  session.targets[tIdx] = { ...session.targets[tIdx], ...patch };
  // 首次 published 记录时间
  if (patch.status === "published" && !session.firstPublishedAt) {
    session.firstPublishedAt = nowIso();
  }
  // 全部目标终态时整体完成
  const allDone = session.targets.every((t) => t.status === "published" || t.status === "skipped");
  if (allDone && session.status !== "archived") {
    session.status = "completed";
  }
  // 使用日志：发布 / 跳过 / 编辑
  if (patch.status === "published") {
    session.usageLog = appendLog(session.usageLog, { event: "target_published", platform });
  } else if (patch.status === "skipped") {
    session.usageLog = appendLog(session.usageLog, { event: "target_skipped", platform });
  } else if (
    (typeof patch.title === "string" || typeof patch.description === "string" || Array.isArray(patch.tags)) &&
    !patch.status
  ) {
    session.usageLog = appendLog(session.usageLog, { event: "target_edited", platform });
  }
  session.updatedAt = nowIso();
  list[idx] = session;
  await writeAll(list);
  return session;
}

function appendLog(log: UsageLogEntry[] | undefined, entry: Omit<UsageLogEntry, "at">): UsageLogEntry[] {
  const next = [...(log || []), { ...entry, at: nowIso() }];
  // 保留最近 100 条
  return next.slice(-100);
}

/** 更新抖音半自动发布执行状态（由 worker 事件驱动） */
export async function updateTargetAssisted(
  sessionId: string,
  platform: PublisherPlatform,
  patch: Partial<
    Pick<
      PublishSessionTarget,
      "assistedStatus" | "assistedError" | "assistedProgress" | "assistedProcessId" | "assistedUpdatedAt"
    >
  >,
): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  const session = list[idx];
  const tIdx = session.targets.findIndex((t) => t.platform === platform);
  if (tIdx === -1) throw new Error("发布目标不存在。");
  const target = { ...session.targets[tIdx], ...patch, assistedUpdatedAt: nowIso() };
  session.targets[tIdx] = target;
  // 进入执行态时把会话标记为 running
  if (
    patch.assistedStatus &&
    patch.assistedStatus !== "pending" &&
    patch.assistedStatus !== "cancelled" &&
    patch.assistedStatus !== "confirmed" &&
    session.status === "ready"
  ) {
    session.status = "running";
  }
  // 用户确认已发布 → 同步 target.status
  if (patch.assistedStatus === "confirmed") {
    target.status = "published";
    target.publishedAt = nowIso();
    if (!session.firstPublishedAt) session.firstPublishedAt = nowIso();
    const allDone = session.targets.every((t) => t.status === "published" || t.status === "skipped");
    if (allDone && session.status !== "archived") session.status = "completed";
  }
  session.updatedAt = nowIso();
  list[idx] = session;
  await writeAll(list);
  return session;
}

/** 推进到下一个未完成平台，返回新的 currentIndex（无则 -1） */
export async function advanceToNextPending(sessionId: string): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  const session = list[idx];
  const nextIdx = session.targets.findIndex((t) => t.status === "pending" || t.status === "opened");
  const updated = await updateSession(sessionId, {
    currentIndex: nextIdx === -1 ? session.currentIndex : nextIdx,
    status: nextIdx === -1 ? "completed" : "running",
  });
  return updated;
}

export async function deleteSession(id: string): Promise<void> {
  const list = await readAll();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) throw new Error("发布会话不存在。");
  await writeAll(next);
}

/** 更新会话的封面候选列表 */
export async function updateCoverCandidates(sessionId: string, candidates: CoverCandidate[]): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  list[idx] = { ...list[idx], coverCandidates: candidates, updatedAt: nowIso() };
  await writeAll(list);
  return list[idx];
}

/** 设置会话的发布就绪度 */
export async function setReadiness(sessionId: string, readiness: PublishReadiness): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  list[idx] = { ...list[idx], readiness, updatedAt: nowIso() };
  await writeAll(list);
  return list[idx];
}

/** 通用追加使用日志 */
export async function appendUsageLog(
  sessionId: string,
  entry: Omit<UsageLogEntry, "at">,
): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  list[idx] = {
    ...list[idx],
    usageLog: appendLog(list[idx].usageLog, entry),
    updatedAt: nowIso(),
  };
  await writeAll(list);
  return list[idx];
}

/** 用户选定封面：写入所有 target.thumbnailPath 并记录日志 */
export async function selectCover(sessionId: string, coverPath: string): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  const session = list[idx];
  session.targets = session.targets.map((t) => ({ ...t, thumbnailPath: coverPath }));
  session.usageLog = appendLog(session.usageLog, { event: "cover_chosen", detail: coverPath });
  session.updatedAt = nowIso();
  list[idx] = session;
  await writeAll(list);
  return session;
}

/** 应用智能适配结果：保留原版本快照、标记 adapted、记录日志
 *  仅覆盖传入 variants 中包含的平台。 */
export async function applyAdaptedVariants(
  sessionId: string,
  variants: Partial<Record<PublisherPlatform, { title: string; description: string; tags: string[] }>>,
  adaptedSource: TargetContentSource,
): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  const session = list[idx];
  // 首次适配：保存原始快照
  let snapshot = session.originalSnapshot;
  if (!snapshot) {
    snapshot = {};
    for (const t of session.targets) {
      snapshot[t.platform] = { title: t.title, description: t.description, tags: [...t.tags] };
    }
  }
  const adaptedPlatforms: PublisherPlatform[] = [];
  session.targets = session.targets.map((t) => {
    const v = variants[t.platform];
    if (!v) return t;
    adaptedPlatforms.push(t.platform);
    return {
      ...t,
      title: v.title,
      description: v.description,
      tags: [...v.tags],
      source: { ...adaptedSource },
      adapted: true,
    };
  });
  session.originalSnapshot = snapshot;
  for (const p of adaptedPlatforms) {
    session.usageLog = appendLog(session.usageLog, { event: "target_adapted", platform: p });
  }
  session.updatedAt = nowIso();
  list[idx] = session;
  await writeAll(list);
  return session;
}

/** 撤销智能适配：从原始快照恢复所有 adapted=true 的平台 */
export async function revertAdaptedVariants(sessionId: string): Promise<PublishSession> {
  const list = await readAll();
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx === -1) throw new Error("发布会话不存在。");
  const session = list[idx];
  const snapshot = session.originalSnapshot;
  if (!snapshot) return session;
  const reverted: PublisherPlatform[] = [];
  session.targets = session.targets.map((t) => {
    if (!t.adapted) return t;
    const orig = snapshot[t.platform];
    if (!orig) return t;
    reverted.push(t.platform);
    return {
      ...t,
      title: orig.title,
      description: orig.description,
      tags: [...orig.tags],
      // 恢复 source：若原始快照无法区分来源，则统一标 generic_fallback（用户可手动重选）
      source: { title: "generic_fallback", description: "generic_fallback", tags: "generic_fallback" },
      adapted: false,
    };
  });
  for (const p of reverted) {
    session.usageLog = appendLog(session.usageLog, { event: "target_adapt_reverted", platform: p });
  }
  session.updatedAt = nowIso();
  list[idx] = session;
  await writeAll(list);
  return session;
}
