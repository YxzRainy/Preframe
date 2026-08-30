/** 素材自动扫描 — 多目录监听、文件稳定检测、轻量指纹去重、ffprobe 元数据
 *
 * 采用轻量扫描与去重策略：
 * - mtime 不足 10s 的文件跳过（仍在导入/导出）
 * - 连续两次扫描 size+mtime 一致才视为稳定
 * - 首尾 64KB hash + size + 规范化文件名去重，不读完整大文件
 * - 改名/移动后迁移记录，不生成重复资产
 *
 * ffprobe 缺失时降级为基础文件信息，明确 capability，不阻塞。 */

import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { readMediaPreferences } from "./mediaPreferences.js";
import {
  findDuplicate,
  migrateAssetPath,
  readMediaAssets,
  upsertAsset,
} from "./mediaAssetStore.js";
import type {
  MediaAsset,
  MediaAssetKind,
  MediaOrientation,
  MediaScanResult,
  MediaScannedDirectory,
  ScanCapability,
} from "../types/mediaAsset.js";
import { normalizeMediaFileName } from "./mediaFileName.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const STABILITY_MIN_INTERVAL_MS = 10_000;
const HASH_CHUNK_SIZE = 64 * 1024;

// ── ffprobe 能力检测（进程级缓存，避免每次扫描都探测） ──
let ffprobeCapability: ScanCapability | null = null;

function detectFfprobe(): Promise<ScanCapability> {
  if (ffprobeCapability) return Promise.resolve(ffprobeCapability);
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("ffprobe", ["-version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      ffprobeCapability = "basic";
      resolve("basic");
    }, 4000);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffprobeCapability = "basic";
      resolve("basic");
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffprobeCapability = code === 0 ? "full" : "basic";
      resolve(ffprobeCapability);
    });
  });
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
}
interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

/** 调用 ffprobe 读取视频/图片元数据。失败返回 undefined，不阻塞。 */
function probeFile(filePath: string): Promise<Partial<MediaAsset> | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve(undefined);
    }, 8000);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (!parsed || typeof parsed !== "object") return resolve(undefined);
        const data = parsed as FfprobeOutput;
        const videoStream = data.streams?.find((s) => s.codec_type === "video");
        const width = videoStream?.width;
        const height = videoStream?.height;
        const durationStr = videoStream?.duration || data.format?.duration;
        const durationSeconds = durationStr ? Number(durationStr) : undefined;
        const fps = parseFps(videoStream?.r_frame_rate);
        const orientation = inferOrientation(width, height);
        resolve({
          durationSeconds: !isNaN(durationSeconds ?? NaN) ? durationSeconds : undefined,
          width,
          height,
          fps,
          orientation,
          codec: videoStream?.codec_name,
        });
      } catch {
        resolve(undefined);
      }
    });
  });
}

function parseFps(rate?: string): number | undefined {
  if (!rate || rate === "0/0") return undefined;
  const match = rate.match(/^(\d+)\/(\d+)$/);
  if (!match) return undefined;
  const den = Number(match[2]);
  if (!den) return undefined;
  return Number(match[1]) / den;
}

function inferOrientation(width?: number, height?: number): MediaOrientation | undefined {
  if (!width || !height) return undefined;
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "square";
}

function isTempOrIncomplete(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(".")) return true;
  if (lower.endsWith(".tmp") || lower.endsWith(".part") || lower.endsWith(".crdownload")) return true;
  if (lower.includes(".downloading")) return true;
  if (lower.startsWith("tmp")) return true;
  return false;
}

function classifyKind(ext: string): MediaAssetKind | undefined {
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return undefined;
}

/** 计算文件首尾各 64KB 的 hash（轻量指纹，不读整部大文件） */
async function computeFileHashes(filePath: string): Promise<{ head?: string; tail?: string }> {
  let handle;
  try {
    handle = await open(filePath, "r");
    const { size } = await handle.stat();
    if (size === 0) return {};
    const headBuf = Buffer.alloc(HASH_CHUNK_SIZE);
    const headResult = await handle.read(headBuf, 0, Math.min(HASH_CHUNK_SIZE, size), 0);
    const headHash = createHash("sha256").update(headBuf.subarray(0, headResult.bytesRead)).digest("hex").slice(0, 16);
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

// ── 模块级稳定性追踪（连续两次扫描 size+mtime 一致才视为稳定） ──
interface StabilityEntry {
  size: number;
  mtime: number;
  stable: boolean;
}
const stabilityMap = new Map<string, StabilityEntry>();

/** 扫描所有启用的素材目录，返回稳定资产列表 */
export async function scanMediaAssets(): Promise<MediaScanResult> {
  const prefs = await readMediaPreferences();
  const capability = await detectFfprobe();
  const existingAssets = await readMediaAssets();
  const assetByPath = new Map(existingAssets.map((a) => [a.path, a]));

  const now = Date.now();
  const results: MediaAsset[] = [];
  const directoryInfos: MediaScannedDirectory[] = [];
  let newCount = 0;
  const seenPaths = new Set<string>();

  for (const dir of prefs.watchedDirectories) {
    let fileCount = 0;
    let exists = false;
    let error: string | undefined;
    try {
      const entries = await readdir(dir.path);
      exists = true;
      fileCount = entries.filter((n) => {
        const ext = path.extname(n).toLowerCase();
        return (VIDEO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) && !isTempOrIncomplete(n);
      }).length;

      if (!dir.enabled) {
        directoryInfos.push({ id: dir.id, path: dir.path, enabled: false, exists, fileCount });
        continue;
      }

      for (const name of entries) {
        if (isTempOrIncomplete(name)) continue;
        const ext = path.extname(name).toLowerCase();
        const kind = classifyKind(ext);
        if (!kind) continue;
        const fullPath = path.resolve(dir.path, name);
        seenPaths.add(fullPath);

        try {
          const s = await stat(fullPath);
          if (!s.isFile()) continue;
          const mtimeMs = s.mtimeMs;
          if (now - mtimeMs < STABILITY_MIN_INTERVAL_MS) continue;

          // 稳定性检测：连续两次扫描 size+mtime 一致
          const prev = stabilityMap.get(fullPath);
          const sameAsPrev = prev !== undefined && prev.size === s.size && prev.mtime === mtimeMs;
          const isStable = sameAsPrev;
          stabilityMap.set(fullPath, {
            size: s.size,
            mtime: mtimeMs,
            stable: isStable || (prev?.stable && sameAsPrev) || false,
          });

          if (!isStable) continue;
          const stableEntry = stabilityMap.get(fullPath);
          if (stableEntry) stableEntry.stable = true;

          const normalizedName = normalizeMediaFileName(name);
          const existing = assetByPath.get(fullPath);

          // 已有记录：保留项目匹配状态，仅刷新文件信息
          if (existing) {
            const needsMetaRefresh =
              existing.sizeBytes !== s.size ||
              existing.modifiedAt !== new Date(mtimeMs).toISOString() ||
              (kind === "video" && capability === "full" && existing.durationSeconds === undefined);
            if (needsMetaRefresh) {
              const meta = kind === "video" || IMAGE_EXTENSIONS.has(ext)
                ? (capability === "full" ? await probeFile(fullPath) : undefined)
                : undefined;
              const { asset } = await upsertAsset({
                id: existing.id,
                path: fullPath,
                fileName: name,
                ext,
                kind,
                sizeBytes: s.size,
                createdAt: existing.createdAt,
                modifiedAt: new Date(mtimeMs).toISOString(),
                normalizedName,
                hashHead: existing.hashHead,
                hashTail: existing.hashTail,
                stable: true,
                durationSeconds: meta?.durationSeconds ?? existing.durationSeconds,
                width: meta?.width ?? existing.width,
                height: meta?.height ?? existing.height,
                fps: meta?.fps ?? existing.fps,
                orientation: meta?.orientation ?? existing.orientation,
                codec: meta?.codec ?? existing.codec,
                projectSlug: existing.projectSlug,
                projectMatchScore: existing.projectMatchScore,
                projectMatchReasons: existing.projectMatchReasons,
                projectMatchStatus: existing.projectMatchStatus,
                projectCandidates: existing.projectCandidates,
              });
              results.push(asset);
            } else {
              results.push(existing);
            }
            continue;
          }

          // 去重：检查是否已有指纹匹配的记录（改名/移动后的同一素材）
          let hashHead: string | undefined;
          let hashTail: string | undefined;
          const dup = findDuplicate(existingAssets, {
            path: fullPath,
            sizeBytes: s.size,
            normalizedName,
          });
          if (dup) {
            if (dup.byHash && dup.record.path !== fullPath) {
              // 迁移路径，保留已有状态
              const migrated = await migrateAssetPath(dup.record.path, fullPath, {
                fileName: name,
                sizeBytes: s.size,
                modifiedAt: new Date(mtimeMs).toISOString(),
                normalizedName,
                stable: true,
              });
              if (migrated) {
                results.push(migrated);
                assetByPath.set(fullPath, migrated);
                continue;
              }
            }
            // 同名同 size 但路径不同：仍当作新资产（可能是不同来源的同名文件）
          }

          // 新资产：计算 hash + ffprobe 元数据
          const hashes = await computeFileHashes(fullPath);
          hashHead = hashes.head;
          hashTail = hashes.tail;

          // hash 强去重
          if (hashHead && hashTail) {
            const hashDup = findDuplicate(existingAssets, {
              path: fullPath,
              sizeBytes: s.size,
              normalizedName,
              hashHead,
              hashTail,
            });
            if (hashDup && hashDup.byHash && hashDup.record.path !== fullPath) {
              const migrated = await migrateAssetPath(hashDup.record.path, fullPath, {
                fileName: name,
                sizeBytes: s.size,
                modifiedAt: new Date(mtimeMs).toISOString(),
                normalizedName,
                hashHead,
                hashTail,
                stable: true,
              });
              if (migrated) {
                results.push(migrated);
                assetByPath.set(fullPath, migrated);
                continue;
              }
            }
          }

          const meta = capability === "full" ? await probeFile(fullPath) : undefined;
          const { asset, isNew } = await upsertAsset({
            path: fullPath,
            fileName: name,
            ext,
            kind,
            sizeBytes: s.size,
            createdAt: new Date(Math.min(s.birthtimeMs || mtimeMs, mtimeMs)).toISOString(),
            modifiedAt: new Date(mtimeMs).toISOString(),
            normalizedName,
            hashHead,
            hashTail,
            stable: true,
            durationSeconds: meta?.durationSeconds,
            width: meta?.width,
            height: meta?.height,
            fps: meta?.fps,
            orientation: meta?.orientation,
            codec: meta?.codec,
          });
          results.push(asset);
          if (isNew) newCount += 1;
          assetByPath.set(fullPath, asset);
        } catch {
          // 单个文件读取失败跳过
        }
      }
    } catch (err) {
      exists = false;
      error = err instanceof Error ? err.message : "目录不存在或无权限";
    }
    directoryInfos.push({ id: dir.id, path: dir.path, enabled: dir.enabled, exists, error, fileCount });
  }

  // 清理 stabilityMap 中不再存在的文件
  for (const key of stabilityMap.keys()) {
    if (!seenPaths.has(key)) {
      try { await stat(key); } catch { stabilityMap.delete(key); }
    }
  }

  // 按修改时间倒序
  results.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));

  return {
    assets: results,
    capability,
    scannedAt: new Date().toISOString(),
    directories: directoryInfos,
    newCount,
  };
}
