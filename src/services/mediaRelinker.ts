/** 素材路径重连 — 素材被移动后，根据一个新目录递归扫描自动重新关联
 *
 * 剪辑师实际痛点：素材目录整体搬迁后，manifest 中 originalPath 全部失效。
 * 不要让用户一个文件一个文件重新找。
 *
 * 匹配优先级：
 * 1. hash（hashHead+hashTail+size）→ 自动重连，高置信
 * 2. size + filename 完全一致 → 自动重连
 * 3. normalized filename 一致 → 模糊，需人工确认
 * 4. size + duration 一致 → 模糊，需人工确认
 *
 * 只把无法确定的展示出来。 */

import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { readMediaAssets, updateAssets, findByPath } from "./mediaAssetStore.js";
import { readEditingManifest, relinkManifestEntry } from "./editingPrepBuilder.js";
import { normalizeVideoName } from "./finalVideoWatcher.js";
import type { EditingManifestEntry } from "../types/editingManifest.js";
import type { MediaAsset } from "../types/mediaAsset.js";

const HASH_CHUNK_SIZE = 64 * 1024;
const MEDIA_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm", ".jpg", ".jpeg", ".png", ".webp", ".m4a", ".aac", ".mp3", ".wav", ".aiff"]);

interface CandidateFile {
  path: string;
  name: string;
  size: number;
  mtime: number;
  normalizedName: string;
  hashHead?: string;
  hashTail?: string;
  duration?: number;
}

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

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve(0);
    }, 8000);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.on("error", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(0); } });
    child.on("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as { streams?: Array<{ duration?: string; codec_type?: string }>; format?: { duration?: string } };
        const vs = parsed.streams?.find((s) => s.codec_type === "video");
        const d = Number(vs?.duration || parsed.format?.duration || 0);
        resolve(isNaN(d) ? 0 : d);
      } catch { resolve(0); }
    });
  });
}

/** 递归扫描目录，收集媒体候选文件 */
async function scanDirectory(rootDir: string, maxFiles = 2000): Promise<CandidateFile[]> {
  const results: CandidateFile[] = [];
  const stack: string[] = [rootDir];
  const visited = new Set<string>();
  while (stack.length > 0 && results.length < maxFiles) {
    const dir = stack.pop()!;
    const real = path.resolve(dir);
    if (visited.has(real)) continue;
    visited.add(real);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch { continue; }
    for (const name of entries) {
      if (results.length >= maxFiles) break;
      const full = path.join(dir, name);
      try {
        const s = await stat(full);
        if (s.isDirectory()) {
          stack.push(full);
        } else if (s.isFile()) {
          const ext = path.extname(name).toLowerCase();
          if (!MEDIA_EXTS.has(ext)) continue;
          results.push({
            path: full,
            name,
            size: s.size,
            mtime: s.mtimeMs,
            normalizedName: normalizeVideoName(name),
          });
        }
      } catch { /* ignore */ }
    }
  }
  return results;
}

export interface RelinkMatch {
  entry: EditingManifestEntry;
  candidate: CandidateFile;
  method: "hash" | "size-filename" | "normalized-name" | "size-duration";
  confidence: "high" | "ambiguous";
}

export interface RelinkResult {
  totalMissing: number;
  autoRelinked: number;
  ambiguous: RelinkMatch[];
  unmatched: EditingManifestEntry[];
  scannedFiles: number;
}

/** 对失效素材在新目录中重新定位 */
export async function relinkFromDirectory(
  slug: string,
  searchDir: string,
): Promise<RelinkResult> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) {
    return { totalMissing: 0, autoRelinked: 0, ambiguous: [], unmatched: [], scannedFiles: 0 };
  }

  // 找出 originalPath 已失效的条目
  const missing: EditingManifestEntry[] = [];
  for (const entry of manifest.entries) {
    try { await stat(entry.originalPath); } catch { missing.push(entry); }
  }

  if (missing.length === 0) {
    return { totalMissing: 0, autoRelinked: 0, ambiguous: [], unmatched: [], scannedFiles: 0 };
  }

  const candidates = await scanDirectory(searchDir);

  // 为失效条目建立索引
  const missingByHash = new Map<string, EditingManifestEntry>();
  const missingByName = new Map<string, EditingManifestEntry[]>();
  const missingByNormalizedName = new Map<string, EditingManifestEntry[]>();
  const missingBySizeDuration = new Map<string, EditingManifestEntry[]>();
  for (const entry of missing) {
    // 用 MediaAsset 中已存的 hash（首选）；无则需对候选计算后比对
    const asset = await findAssetForEntry(entry);
    if (asset?.hashHead && asset?.hashTail) {
      missingByHash.set(`${asset.hashHead}|${asset.hashTail}|${entry.sizeBytes}`, entry);
    }
    const nm = path.basename(entry.originalFileName);
    pushMap(missingByName, nm, entry);
    pushMap(missingByNormalizedName, normalizeVideoName(entry.originalFileName), entry);
    if (entry.duration && entry.duration > 0) {
      pushMap(missingBySizeDuration, `${entry.sizeBytes}|${Math.round(entry.duration)}`, entry);
    }
  }

  // 为候选计算 hash / duration（按需），逐个匹配
  const ambiguous: RelinkMatch[] = [];
  const matchedEntryIds = new Set<string>();
  let autoRelinked = 0;
  const allAssets = await readMediaAssets();

  for (const cand of candidates) {
    // 找尚未匹配且与该候选可能对应的失效条目
    const candidates_entry: Array<{ entry: EditingManifestEntry; method: RelinkMatch["method"]; confidence: RelinkMatch["confidence"] }> = [];

    // 2. size + filename
    const byName = missingByName.get(cand.name) || [];
    for (const entry of byName) {
      if (matchedEntryIds.has(entry.assetId)) continue;
      if (entry.sizeBytes === cand.size) {
        candidates_entry.push({ entry, method: "size-filename", confidence: "high" });
      }
    }

    // 1. hash（需计算候选 hash）
    if (candidates_entry.length === 0) {
      const hashes = await computeFileHashes(cand.path);
      cand.hashHead = hashes.head;
      cand.hashTail = hashes.tail;
      if (cand.hashHead && cand.hashTail) {
        const entry = missingByHash.get(`${cand.hashHead}|${cand.hashTail}|${cand.size}`);
        if (entry && !matchedEntryIds.has(entry.assetId)) {
          candidates_entry.push({ entry, method: "hash", confidence: "high" });
        }
      }
      // 3. normalized filename
      if (candidates_entry.length === 0) {
        const byNorm = missingByNormalizedName.get(cand.normalizedName) || [];
        for (const entry of byNorm) {
          if (matchedEntryIds.has(entry.assetId)) continue;
          candidates_entry.push({ entry, method: "normalized-name", confidence: "ambiguous" });
        }
      }
      // 4. size + duration
      if (candidates_entry.length === 0) {
        const dur = await probeDuration(cand.path);
        cand.duration = dur;
        if (dur > 0) {
          const bySd = missingBySizeDuration.get(`${cand.size}|${Math.round(dur)}`) || [];
          for (const entry of bySd) {
            if (matchedEntryIds.has(entry.assetId)) continue;
            candidates_entry.push({ entry, method: "size-duration", confidence: "ambiguous" });
          }
        }
      }
    }

    if (candidates_entry.length === 0) continue;

    // 高置信：自动重连
    const high = candidates_entry.find((c) => c.confidence === "high");
    if (high) {
      matchedEntryIds.add(high.entry.assetId);
      await applyRelink(slug, high.entry, cand, allAssets);
      autoRelinked += 1;
    } else {
      // 模糊：收集待人工确认（一个候选可能对应多个条目）
      for (const c of candidates_entry) {
        if (matchedEntryIds.has(c.entry.assetId)) continue;
        ambiguous.push({ entry: c.entry, candidate: cand, method: c.method, confidence: c.confidence });
      }
    }
  }

  // 对模糊结果去重：每个失效条目最多保留 3 个候选
  const ambiguousByEntry = new Map<string, RelinkMatch[]>();
  for (const m of ambiguous) {
    if (matchedEntryIds.has(m.entry.assetId)) continue;
    const arr = ambiguousByEntry.get(m.entry.assetId) || [];
    if (arr.length < 3) arr.push(m);
    ambiguousByEntry.set(m.entry.assetId, arr);
  }
  const ambiguousDeduped: RelinkMatch[] = [];
  for (const arr of ambiguousByEntry.values()) {
    ambiguousDeduped.push(...arr);
    matchedEntryIds.add(arr[0].entry.assetId);
  }

  const unmatched = missing.filter((e) => !matchedEntryIds.has(e.assetId));

  return {
    totalMissing: missing.length,
    autoRelinked,
    ambiguous: ambiguousDeduped,
    unmatched,
    scannedFiles: candidates.length,
  };
}

function pushMap<K>(map: Map<K, EditingManifestEntry[]>, key: K, entry: EditingManifestEntry): void {
  const arr = map.get(key) || [];
  arr.push(entry);
  map.set(key, arr);
}

async function findAssetForEntry(entry: EditingManifestEntry): Promise<MediaAsset | undefined> {
  const assets = await readMediaAssets();
  return assets.find((a) => a.id === entry.assetId);
}

/** 应用重连：更新 manifest + MediaAsset 路径 + 重建 symlink */
async function applyRelink(
  slug: string,
  entry: EditingManifestEntry,
  candidate: CandidateFile,
  allAssets: MediaAsset[],
): Promise<void> {
  // 更新 manifest（含重建 symlink）
  await relinkManifestEntry(slug, entry.assetId, candidate.path);
  // 同步更新 MediaAsset 记录的 path（若存在）
  const asset = findByPath(allAssets, entry.originalPath) || allAssets.find((a) => a.id === entry.assetId);
  if (asset && asset.path !== candidate.path) {
    const updated: MediaAsset = {
      ...asset,
      path: candidate.path,
      fileName: candidate.name,
      sizeBytes: candidate.size,
      modifiedAt: new Date(candidate.mtime).toISOString(),
      hashHead: candidate.hashHead || asset.hashHead,
      hashTail: candidate.hashTail || asset.hashTail,
    };
    await updateAssets([updated]);
  }
}

/** 人工确认一条模糊匹配（用户选择某个候选） */
export async function confirmAmbiguousRelink(
  slug: string,
  assetId: string,
  newPath: string,
): Promise<{ ok: boolean; reason: string }> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return { ok: false, reason: "剪辑清单不存在。" };
  const entry = manifest.entries.find((e) => e.assetId === assetId);
  if (!entry) return { ok: false, reason: "素材不在清单中。" };
  try {
    const s = await stat(newPath);
    if (!s.isFile()) return { ok: false, reason: "所选路径不是文件。" };
  } catch {
    return { ok: false, reason: "所选文件不存在。" };
  }
  const allAssets = await readMediaAssets();
  await applyRelink(slug, entry, {
    path: newPath,
    name: path.basename(newPath),
    size: 0,
    mtime: 0,
    normalizedName: normalizeVideoName(path.basename(newPath)),
  }, allAssets);
  return { ok: true, reason: "已重新关联。" };
}
