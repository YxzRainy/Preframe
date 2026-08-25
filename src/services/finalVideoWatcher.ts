/** 成片目录扫描 — 多目录监听、文件稳定检测、轻量指纹去重
 * 不复制、不上传、不用永久内存 Map 存储视频内容。
 * 稳定性检测：同一文件连续两次扫描的 size+mtime 一致才视为导出完成。
 * 指纹去重：path + size + normalizedName + 首尾 64KB hash，不读整部大视频。 */

import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { getOutputDirSync } from "./workspaceConfig.js";
import { readPreferences } from "./publisherPreferences.js";
import {
  findDuplicate,
  listAllRecords,
  migrateRecordPath,
  upsertRecord,
} from "./finalVideoStore.js";
import type { FinalVideoRecord } from "../types/publishSession.js";

const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const STABILITY_MIN_INTERVAL_MS = 10_000; // mtime 不足 10s 的文件跳过
const HASH_CHUNK_SIZE = 64 * 1024; // 首尾各 64KB

/** 临时/未完成下载文件特征 */
function isTempOrIncomplete(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(".")) return true;
  if (lower.endsWith(".tmp") || lower.endsWith(".part") || lower.endsWith(".crdownload")) return true;
  if (lower.includes(".downloading")) return true;
  if (lower.startsWith("tmp")) return true;
  return false;
}

/** 规范化文件名：去后缀、去常见导出标记、小写、去标点 */
export function normalizeVideoName(name: string): string {
  const base = name.replace(/\.[^.]+$/, ""); // 去扩展名
  return base
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(final|成片|cut|export|render|v\d+)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析目录为绝对路径：相对路径相对于项目工作区父目录 */
function resolveDirectory(dir: string): string {
  const trimmed = dir.trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(getOutputDirSync(), "..", trimmed);
}

/** 计算文件首尾各 64KB 的 hash（轻量指纹，不读整部大视频） */
async function computeFileHashes(filePath: string): Promise<{ head?: string; tail?: string }> {
  let handle;
  try {
    handle = await open(filePath, "r");
    const { size } = await handle.stat();
    if (size === 0) return {};
    const headBuf = Buffer.alloc(HASH_CHUNK_SIZE);
    const headResult = await handle.read(headBuf, 0, Math.min(HASH_CHUNK_SIZE, size), 0);
    const headHash = createHash("sha256").update(headBuf.subarray(0, headResult.bytesRead)).digest("hex").slice(0, 16);
    // 尾部：如果文件大于 64KB，读取尾部
    if (size > HASH_CHUNK_SIZE) {
      const tailBuf = Buffer.alloc(HASH_CHUNK_SIZE);
      const tailOffset = size - HASH_CHUNK_SIZE;
      const tailResult = await handle.read(tailBuf, 0, HASH_CHUNK_SIZE, tailOffset);
      const tailHash = createHash("sha256").update(tailBuf.subarray(0, tailResult.bytesRead)).digest("hex").slice(0, 16);
      return { head: headHash, tail: tailHash };
    }
    return { head: headHash, tail: headHash };
  } catch {
    return {};
  } finally {
    await handle?.close().catch(() => {});
  }
}

export interface DiscoveredFinalVideo extends FinalVideoRecord {
  isNew: boolean;
  /** 目录不存在等扫描错误 */
  directoryError?: string;
}

export interface ScanResult {
  videos: DiscoveredFinalVideo[];
  directories: ScannedDirectoryInfo[];
  total: number;
}

export interface ScannedDirectoryInfo {
  path: string;
  resolved: string;
  enabled: boolean;
  exists: boolean;
  error?: string;
  fileCount: number;
}

// ── 模块级稳定性追踪（连续两次扫描 size+mtime 一致才视为稳定） ──
interface StabilityEntry {
  size: number;
  mtime: number;
  firstSeenAt: number;
  lastSeenAt: number;
  stable: boolean;
}
const stabilityMap = new Map<string, StabilityEntry>();

/**
 * 扫描所有启用的成片目录。
 * - 支持多目录
 * - 忽略隐藏/临时/未完成下载文件
 * - mtime 不足 10s 的文件跳过（仍在导出）
 * - 连续两次扫描 size+mtime 一致才视为稳定
 * - 轻量指纹去重（改名/移动后识别为同一成片）
 */
export async function scanFinalVideos(): Promise<DiscoveredFinalVideo[]> {
  const prefs = await readPreferences();
  const enabledDirs = prefs.watchedVideoDirectories.filter((d) => d.enabled);
  const allRecords = await listAllRecords();
  const recordByPath = new Map(allRecords.map((r) => [r.path, r]));

  const results: DiscoveredFinalVideo[] = [];
  const now = Date.now();

  for (const dir of enabledDirs) {
    const resolved = resolveDirectory(dir.path);
    let entries: string[];
    try {
      entries = await readdir(resolved);
    } catch {
      // 目录不存在或无权限：跳过（前端通过 resolveFinalVideoDirectories 显示状态）
      continue;
    }

    for (const name of entries) {
      if (isTempOrIncomplete(name)) continue;
      const ext = path.extname(name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;
      const fullPath = path.join(resolved, name);
      try {
        const s = await stat(fullPath);
        if (!s.isFile()) continue;
        const mtimeMs = s.mtimeMs;

        // mtime 不足 10s 跳过（剪辑软件仍在导出）
        if (now - mtimeMs < STABILITY_MIN_INTERVAL_MS) continue;

        // 稳定性检测：连续两次扫描 size+mtime 一致
        const prev = stabilityMap.get(fullPath);
        const isStable = prev !== undefined && prev.size === s.size && prev.mtime === mtimeMs && prev.stable;
        stabilityMap.set(fullPath, {
          size: s.size,
          mtime: mtimeMs,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSeenAt: now,
          stable: isStable || (prev !== undefined && prev.size === s.size && prev.mtime === mtimeMs),
        });

        // 未稳定的不展示（等下一次扫描确认）
        if (!isStable && !(prev !== undefined && prev.size === s.size && prev.mtime === mtimeMs)) {
          continue;
        }

        // 标记为稳定
        const stableEntry = stabilityMap.get(fullPath);
        if (stableEntry) stableEntry.stable = true;

        const existing = recordByPath.get(fullPath);
        const normalizedName = normalizeVideoName(name);

        // 去重检测：如果该文件已忽略或已关联会话，跳过
        if (existing?.dismissed || existing?.sessionId) {
          // 更新 mtime/size（文件可能被重新导出）
          if (existing.sizeBytes !== s.size || existing.mtime !== new Date(mtimeMs).toISOString()) {
            await upsertRecord(fullPath, {
              sizeBytes: s.size,
              mtime: new Date(mtimeMs).toISOString(),
              normalizedName,
              stable: true,
            });
          }
          continue;
        }

        // 检查是否已有指纹匹配的记录（改名/移动后的同一视频）
        const dup = await findDuplicate({
          path: fullPath,
          name,
          sizeBytes: s.size,
          normalizedName,
        });

        if (dup && (dup.record.dismissed || dup.record.sessionId)) {
          // 同一视频（改名/移动）已处理过，跳过
          continue;
        }

        // 计算首尾 hash（仅对新稳定的文件，避免每次扫描都读文件）
        let hashHead = existing?.hashHead;
        let hashTail = existing?.hashTail;
        if (!hashHead) {
          const hashes = await computeFileHashes(fullPath);
          hashHead = hashes.head;
          hashTail = hashes.tail;
        }

        // 再次用 hash 去重
        if (hashHead && hashTail) {
          const hashDup = await findDuplicate({
            path: fullPath,
            name,
            sizeBytes: s.size,
            hashHead,
            hashTail,
          });
          if (hashDup) {
            // 同一视频（改名/移动后）：已处理过则跳过
            if (hashDup.record.dismissed || hashDup.record.sessionId) {
              continue;
            }
            // 原记录未 dismissed/无 sessionId：迁移路径，保留已有状态，不当作新发现
            if (hashDup.record.path !== fullPath) {
              const migrated = await migrateRecordPath(hashDup.record.path, fullPath, {
                name,
                sizeBytes: s.size,
                mtime: new Date(mtimeMs).toISOString(),
                normalizedName,
                hashHead,
                hashTail,
                stable: true,
              });
              if (migrated) {
                // 仍展示给用户（isNew=false），但不当作新发现
                results.push({ ...migrated, isNew: false });
                continue;
              }
            }
          }
        }

        // 更新或创建记录
        const updated = await upsertRecord(fullPath, {
          name,
          sizeBytes: s.size,
          mtime: new Date(mtimeMs).toISOString(),
          normalizedName,
          hashHead,
          hashTail,
          stable: true,
        });

        results.push({
          ...updated,
          isNew: !existing,
        });
      } catch {
        // 单个文件读取失败跳过
      }
    }
  }

  // 清理 stabilityMap 中不再存在的文件（避免内存增长）
  for (const key of stabilityMap.keys()) {
    try {
      await stat(key);
    } catch {
      stabilityMap.delete(key);
    }
  }

  // 按修改时间倒序
  results.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return results;
}

/** 返回所有配置的目录信息（含存在性检查） */
export async function resolveFinalVideoDirectories(): Promise<ScannedDirectoryInfo[]> {
  const prefs = await readPreferences();
  const dirs: ScannedDirectoryInfo[] = [];
  for (const dir of prefs.watchedVideoDirectories) {
    const resolved = resolveDirectory(dir.path);
    let exists = false;
    let error: string | undefined;
    let fileCount = 0;
    try {
      const entries = await readdir(resolved);
      exists = true;
      fileCount = entries.filter((n) => ALLOWED_EXTENSIONS.has(path.extname(n).toLowerCase()) && !isTempOrIncomplete(n)).length;
    } catch (err) {
      exists = false;
      error = err instanceof Error ? err.message : "目录不存在或无权限";
    }
    dirs.push({ path: dir.path, resolved, enabled: dir.enabled, exists, error, fileCount });
  }
  return dirs;
}

/** @deprecated 使用 resolveFinalVideoDirectories 代替。保留向后兼容 */
export async function resolveFinalVideoDirectory(): Promise<string> {
  const dirs = await resolveFinalVideoDirectories();
  const enabled = dirs.find((d) => d.enabled);
  return enabled?.resolved || dirs[0]?.resolved || "";
}

/** 返回启用的目录路径列表（用于前端显示） */
export async function getEnabledDirectoryPaths(): Promise<string[]> {
  const dirs = await resolveFinalVideoDirectories();
  return dirs.filter((d) => d.enabled).map((d) => d.path);
}
