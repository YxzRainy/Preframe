/** 成片记录存储 — .piance/final-videos.json
 * 记录已发现/忽略/已建会话的成片，含轻量指纹用于改名/移动后去重。 */

import { nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type { FinalVideoRecord } from "../types/publishSession.js";

const FILE_NAME = "final-videos.json";

interface FinalVideoStoreData {
  records: FinalVideoRecord[];
}

function normalizeRecord(value: unknown): FinalVideoRecord | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.path !== "string" || typeof rec.name !== "string") return null;
  return {
    path: rec.path,
    name: rec.name,
    sizeBytes: typeof rec.sizeBytes === "number" ? rec.sizeBytes : 0,
    mtime: typeof rec.mtime === "string" ? rec.mtime : nowIso(),
    dismissed: typeof rec.dismissed === "boolean" ? rec.dismissed : undefined,
    dismissedAt: typeof rec.dismissedAt === "string" ? rec.dismissedAt : undefined,
    sessionId: typeof rec.sessionId === "string" ? rec.sessionId : undefined,
    normalizedName: typeof rec.normalizedName === "string" ? rec.normalizedName : undefined,
    hashHead: typeof rec.hashHead === "string" ? rec.hashHead : undefined,
    hashTail: typeof rec.hashTail === "string" ? rec.hashTail : undefined,
    stable: typeof rec.stable === "boolean" ? rec.stable : undefined,
  };
}

async function readAll(): Promise<FinalVideoRecord[]> {
  const data = await readAtomicJson<FinalVideoStoreData>(FILE_NAME, { records: [] });
  const records = Array.isArray(data.records)
    ? (data.records.map(normalizeRecord).filter(Boolean) as FinalVideoRecord[])
    : [];
  return records;
}

async function writeAll(records: FinalVideoRecord[]): Promise<void> {
  await writeAtomicJson<FinalVideoStoreData>(FILE_NAME, { records });
}

/** 按 path 建立索引 */
async function readIndex(): Promise<Map<string, FinalVideoRecord>> {
  const records = await readAll();
  return new Map(records.map((r) => [r.path, r]));
}

export async function findRecord(videoPath: string): Promise<FinalVideoRecord | null> {
  const idx = await readIndex();
  return idx.get(videoPath) ?? null;
}

/** 按 path 查找记录（不关心是否已忽略） */
export async function findRecordByPath(videoPath: string): Promise<FinalVideoRecord | null> {
  return findRecord(videoPath);
}

export interface DedupMatch {
  record: FinalVideoRecord;
  reason: "path" | "size+name" | "hash";
}

/**
 * 去重匹配：检测该视频是否已存在记录（改名/移动后尽量识别为同一个成片）
 * 匹配优先级：path > size+normalizedName > hashHead+hashTail+size
 * 禁止读取整部大视频计算完整 hash，只比较轻量指纹。
 */
export async function findDuplicate(
  candidate: {
    path: string;
    name: string;
    sizeBytes: number;
    normalizedName?: string;
    hashHead?: string;
    hashTail?: string;
  },
): Promise<DedupMatch | null> {
  const records = await readAll();

  // 1. path 精确匹配
  const byPath = records.find((r) => r.path === candidate.path);
  if (byPath) return { record: byPath, reason: "path" };

  // 2. size + normalizedName 匹配（改名后同一视频）
  if (candidate.normalizedName && candidate.sizeBytes > 0) {
    const byNameSize = records.find(
      (r) =>
        r.sizeBytes === candidate.sizeBytes &&
        r.normalizedName === candidate.normalizedName,
    );
    if (byNameSize) return { record: byNameSize, reason: "size+name" };
  }

  // 3. hashHead + hashTail + size 强匹配（移动/改名后同一视频）
  if (candidate.hashHead && candidate.hashTail && candidate.sizeBytes > 0) {
    const byHash = records.find(
      (r) =>
        r.sizeBytes === candidate.sizeBytes &&
        r.hashHead === candidate.hashHead &&
        r.hashTail === candidate.hashTail,
    );
    if (byHash) return { record: byHash, reason: "hash" };
  }

  return null;
}

/** 更新或插入记录（按 path upsert） */
export async function upsertRecord(
  videoPath: string,
  patch: Partial<FinalVideoRecord>,
): Promise<FinalVideoRecord> {
  const records = await readAll();
  const idx = records.findIndex((r) => r.path === videoPath);
  if (idx === -1) {
    const newRec: FinalVideoRecord = {
      path: videoPath,
      name: patch.name ?? videoPath.split(/[/\\]/).pop() ?? videoPath,
      sizeBytes: patch.sizeBytes ?? 0,
      mtime: patch.mtime ?? nowIso(),
      ...patch,
    };
    records.push(newRec);
    await writeAll(records);
    return newRec;
  }
  records[idx] = { ...records[idx], ...patch };
  await writeAll(records);
  return records[idx];
}

/** 迁移记录路径（改名/移动后同一视频，保留 dismissed/sessionId 状态） */
export async function migrateRecordPath(
  oldPath: string,
  newPath: string,
  patch: Partial<FinalVideoRecord>,
): Promise<FinalVideoRecord | null> {
  const records = await readAll();
  const idx = records.findIndex((r) => r.path === oldPath);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], path: newPath, ...patch };
  await writeAll(records);
  return records[idx];
}

/** 标记忽略 */
export async function dismissVideo(videoPath: string): Promise<FinalVideoRecord | null> {
  const records = await readAll();
  const idx = records.findIndex((r) => r.path === videoPath);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], dismissed: true, dismissedAt: nowIso() };
  await writeAll(records);
  return records[idx];
}

/** 关联会话 id（同时标记 dismissed 避免重复发现） */
export async function attachSession(videoPath: string, sessionId: string): Promise<void> {
  const records = await readAll();
  const idx = records.findIndex((r) => r.path === videoPath);
  if (idx === -1) return;
  records[idx] = { ...records[idx], sessionId, dismissed: true, dismissedAt: nowIso() };
  await writeAll(records);
}

/** 取消忽略 */
export async function restoreVideo(videoPath: string): Promise<FinalVideoRecord | null> {
  const records = await readAll();
  const idx = records.findIndex((r) => r.path === videoPath);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], dismissed: false, dismissedAt: undefined };
  await writeAll(records);
  return records[idx];
}

/** 读取全部记录（用于扫描时合并状态） */
export async function listAllRecords(): Promise<FinalVideoRecord[]> {
  return readAll();
}
