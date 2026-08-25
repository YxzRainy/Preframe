/** 剪辑工作区构建 — 创建标准 editing 目录、symlink 原素材、写 EDITING_MANIFEST.json
 *
 * 边界：
 * - 不复制原素材，editing/media 默认使用 symlink（fs.symlink）
 * - 不移动/不重命名原始素材；仅重命名 editing/media 中的 symlink
 * - symlink 创建失败不阻塞，manifest 仍记录 originalPath
 * - 刷新后状态不丢（manifest 持久化在项目 editing/ 目录） */

import { access, lstat, mkdir, readdir, readFile, readlink, rename, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveProjectDirectory } from "./projectManager.js";
import { readMediaAssets } from "./mediaAssetStore.js";
import { getLinksForProject } from "./shotAssetLinkStore.js";
import { nowIso } from "./atomicJson.js";
import type { ShotAssetLink } from "../types/mediaAsset.js";
import type {
  EditingAssetType,
  EditingManifest,
  EditingManifestEntry,
} from "../types/editingManifest.js";

const MANIFEST_FILE = "EDITING_MANIFEST.json";
const EDITING_SUBDIRS = ["media", "proxy", "audio", "images", "subtitles", "exports", "project-files"];

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const AUDIO_EXTS = new Set([".m4a", ".aac", ".mp3", ".wav", ".aiff"]);

function classifyType(ext: string): EditingAssetType | undefined {
  const e = ext.toLowerCase();
  if (VIDEO_EXTS.has(e)) return "video";
  if (IMAGE_EXTS.has(e)) return "image";
  if (AUDIO_EXTS.has(e)) return "audio";
  return undefined;
}

function editingDirFor(slug: string): string {
  return path.join(resolveProjectDirectory(slug), "editing");
}

function manifestPathFor(slug: string): string {
  return path.join(editingDirFor(slug), MANIFEST_FILE);
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** 读取现有 manifest（不存在返回 null） */
export async function readEditingManifest(slug: string): Promise<EditingManifest | null> {
  try {
    const raw = await readFile(manifestPathFor(slug), "utf8");
    const parsed = JSON.parse(raw) as EditingManifest;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// 进程内互斥锁：串行化 manifest 读-改-写，避免并发 proxy 完成时丢失更新
let manifestLockChain: Promise<unknown> = Promise.resolve();
async function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = manifestLockChain.then(fn, fn);
  manifestLockChain = run.then(() => undefined, () => undefined);
  return run;
}

async function writeEditingManifest(slug: string, manifest: EditingManifest): Promise<void> {
  const dir = editingDirFor(slug);
  await mkdir(dir, { recursive: true });
  // 原子写入：临时文件 + rename，避免并发写损坏
  const target = manifestPathFor(slug);
  const rand = Math.random().toString(16).slice(2, 10);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${rand}`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, target);
  } catch (error) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw error;
  }
}

/** 生成剪辑友好文件名。
 * - 已关联 ShotTask：S<order>_<shotType/口播>_<原文件名>.<ext>
 * - 未关联：MEDIA_<序号>.<ext>
 * 仅作用于 editing/media 中的 symlink 名称，不改原素材。 */
export function buildDisplayName(
  entry: { originalFileName: string; shotOrder?: number; shotTaskId?: string; type: EditingAssetType },
  shotTypeByTask: Map<string, string>,
  index: number,
): string {
  const ext = path.extname(entry.originalFileName);
  const base = entry.originalFileName.replace(/\.[^.]+$/, "");
  if (entry.shotTaskId && entry.shotOrder !== undefined) {
    const shotType = shotTypeByTask.get(entry.shotTaskId) || "镜头";
    const tag = shotType.replace(/[/\\:*?"<>|\s]+/g, "_").slice(0, 12) || "shot";
    return `S${String(entry.shotOrder).padStart(2, "0")}_${tag}_${base}${ext}`;
  }
  return `MEDIA_${String(index).padStart(3, "0")}${ext}`;
}

/** 避免 editing/media 内 symlink 重名：撞名时追加序号后缀 */
async function uniqueEditingPath(mediaDir: string, displayName: string): Promise<string> {
  let candidate = path.join(mediaDir, displayName);
  if (!(await pathExists(candidate))) return candidate;
  const ext = path.extname(displayName);
  const base = displayName.replace(/\.[^.]+$/, "");
  let n = 2;
  while (await pathExists(path.join(mediaDir, `${base}_${n}${ext}`))) n += 1;
  return path.join(mediaDir, `${base}_${n}${ext}`);
}

/** 创建 symlink（覆盖已存在的失效链接）。失败返回 false，不抛错。 */
async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    // 若已存在同名链接/文件，先检查是否已指向同一目标
    try {
      const existing = await lstat(linkPath);
      if (existing.isSymbolicLink()) {
        const real = await readlink(linkPath).catch(() => "");
        if (real === target) return true;
        await unlink(linkPath);
      } else {
        // 已存在普通文件，不覆盖，换名
        return false;
      }
    } catch {
      // 不存在，继续创建
    }
    await symlink(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

export interface PrepareEditingResult {
  manifest: EditingManifest;
  createdDirs: string[];
  symlinkCount: number;
  symlinkFailed: number;
}

/** 一键准备剪辑工作区：创建目录 + symlink 原素材 + 写 manifest */
export async function prepareEditingWorkspace(slug: string): Promise<PrepareEditingResult> {
  const projectDir = resolveProjectDirectory(slug);
  const editingDir = editingDirFor(slug);
  const mediaDir = path.join(editingDir, "media");

  // 1. 创建标准子目录
  const createdDirs: string[] = [];
  for (const sub of EDITING_SUBDIRS) {
    const d = path.join(editingDir, sub);
    if (!(await pathExists(d))) {
      await mkdir(d, { recursive: true });
      createdDirs.push(d);
    }
  }

  // 2. 读取项目素材 + 镜头关系
  const [allAssets, links] = await Promise.all([
    readMediaAssets(),
    getLinksForProject(slug),
  ]);
  const projectAssets = allAssets.filter((a) => a.projectSlug === slug);

  // shotTaskId → shotType / order 映射（从 confirmed 主关系推断 order）
  const shotTypeByTask = new Map<string, string>();
  const orderByTask = new Map<string, number>();
  // 读取 project.json shotTasks 以获得 order + shotType
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const pj = JSON.parse(raw) as { shotTasks?: Array<{ id: string; order: number; shotType: string }> };
    for (const st of pj.shotTasks || []) {
      shotTypeByTask.set(st.id, st.shotType || "镜头");
      orderByTask.set(st.id, st.order);
    }
  } catch {
    // 无 shotTasks 时退化为 MEDIA_ 序号
  }

  // 每个素材的主镜头关系（primary confirmed 优先）
  const primaryShotByAsset = new Map<string, ShotAssetLink>();
  for (const l of links) {
    if (l.status !== "confirmed") continue;
    const cur = primaryShotByAsset.get(l.assetId);
    if (!cur || (l.primary && !cur.primary)) primaryShotByAsset.set(l.assetId, l);
  }

  // 3. 读取旧 manifest 以保留 proxy 状态
  const oldManifest = await readEditingManifest(slug);
  const oldEntryByAssetId = new Map((oldManifest?.entries || []).map((e) => [e.assetId, e]));

  // 4. 为每个素材生成 entry + symlink
  const entries: EditingManifestEntry[] = [];
  let symlinkCount = 0;
  let symlinkFailed = 0;
  let mediaIndex = 0;

  for (const asset of projectAssets) {
    const type = classifyType(asset.ext);
    if (!type) continue;
    mediaIndex += 1;

    const shotLink = primaryShotByAsset.get(asset.id);
    const shotTaskId = shotLink?.shotTaskId;
    const shotOrder = shotTaskId ? orderByTask.get(shotTaskId) : undefined;

    const displayName = buildDisplayName(
      { originalFileName: asset.fileName, shotOrder, shotTaskId, type },
      shotTypeByTask,
      mediaIndex,
    );
    const editingPath = await uniqueEditingPath(mediaDir, displayName);

    const symlinkOk = await createSymlink(asset.path, editingPath);
    if (symlinkOk) symlinkCount += 1;
    else symlinkFailed += 1;

    const old = oldEntryByAssetId.get(asset.id);
    const now = nowIso();
    const entry: EditingManifestEntry = {
      assetId: asset.id,
      originalPath: asset.path,
      editingPath,
      displayName: path.basename(editingPath),
      originalFileName: asset.fileName,
      type,
      sizeBytes: asset.sizeBytes,
      symlinkOk,
      duration: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      codec: asset.codec,
      orientation: asset.orientation,
      shotTaskId,
      shotOrder,
      // 保留旧 proxy 状态（由 proxyManager 单独刷新）
      proxyStatus: old?.proxyStatus,
      proxyPreset: old?.proxyPreset,
      proxyPath: old?.proxyPath,
      proxySizeBytes: old?.proxySizeBytes,
      proxyStale: old?.proxyStale,
      proxySourceFingerprint: old?.proxySourceFingerprint,
      addedAt: old?.addedAt || now,
      updatedAt: now,
    };
    entries.push(entry);
  }

  const now = nowIso();
  const manifest: EditingManifest = {
    projectSlug: slug,
    editingDir,
    createdAt: oldManifest?.createdAt || now,
    updatedAt: now,
    entries,
  };
  await writeEditingManifest(slug, manifest);

  return { manifest, createdDirs, symlinkCount, symlinkFailed };
}

/** 检查 manifest 中 originalPath 是否仍存在；返回失效条目 */
export async function detectMissingSources(slug: string): Promise<{
  missing: EditingManifestEntry[];
  total: number;
}> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return { missing: [], total: 0 };
  const missing: EditingManifestEntry[] = [];
  for (const entry of manifest.entries) {
    if (!(await pathExists(entry.originalPath))) {
      missing.push(entry);
    }
  }
  return { missing, total: manifest.entries.length };
}

/** 同步 manifest 中的 proxy 状态（由 proxyManager 调用，可能并发） */
export async function updateManifestProxyFields(
  slug: string,
  assetId: string,
  patch: Partial<EditingManifestEntry>,
): Promise<EditingManifest | null> {
  return withManifestLock(async () => {
    const manifest = await readEditingManifest(slug);
    if (!manifest) return null;
    const idx = manifest.entries.findIndex((e) => e.assetId === assetId);
    if (idx < 0) return manifest;
    manifest.entries[idx] = {
      ...manifest.entries[idx],
      ...patch,
      updatedAt: nowIso(),
    };
    manifest.updatedAt = nowIso();
    await writeEditingManifest(slug, manifest);
    return manifest;
  });
}

/** 更新 manifest 条目的 originalPath（relink 成功后）并重建 symlink */
export async function relinkManifestEntry(
  slug: string,
  assetId: string,
  newOriginalPath: string,
): Promise<EditingManifest | null> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return null;
  const idx = manifest.entries.findIndex((e) => e.assetId === assetId);
  if (idx < 0) return manifest;
  const entry = manifest.entries[idx];
  const oldEditingPath = entry.editingPath;
  entry.originalPath = newOriginalPath;
  entry.updatedAt = nowIso();
  // 重建 symlink：先移除旧链接（含失效链接），再创建新链接
  try {
    try {
      const info = await lstat(oldEditingPath);
      // lstat 不跟随 symlink，可识别失效链接
      if (info.isSymbolicLink() || info.isFile()) await unlink(oldEditingPath);
    } catch {
      // 旧链接不存在，直接创建
    }
    await symlink(newOriginalPath, oldEditingPath);
    entry.symlinkOk = true;
  } catch {
    entry.symlinkOk = false;
  }
  manifest.entries[idx] = entry;
  manifest.updatedAt = nowIso();
  await writeEditingManifest(slug, manifest);
  return manifest;
}

export interface RenameResult {
  renamed: number;
  skipped: number;
  manifest: EditingManifest | null;
}

/** 重新生成 editing/media 中 symlink 的剪辑友好名（不改原素材） */
export async function renameEditingSymlinks(slug: string): Promise<RenameResult> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return { renamed: 0, skipped: 0, manifest: null };
  const projectDir = resolveProjectDirectory(slug);
  const shotTypeByTask = new Map<string, string>();
  const orderByTask = new Map<string, number>();
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const pj = JSON.parse(raw) as { shotTasks?: Array<{ id: string; order: number; shotType: string }> };
    for (const st of pj.shotTasks || []) {
      shotTypeByTask.set(st.id, st.shotType || "镜头");
      orderByTask.set(st.id, st.order);
    }
  } catch { /* ignore */ }

  const mediaDir = path.join(manifest.editingDir, "media");
  let mediaIndex = 0;
  let renamed = 0;
  let skipped = 0;
  for (const entry of manifest.entries) {
    mediaIndex += 1;
    const newName = buildDisplayName(
      { originalFileName: entry.originalFileName, shotOrder: entry.shotOrder, shotTaskId: entry.shotTaskId, type: entry.type },
      shotTypeByTask,
      mediaIndex,
    );
    if (newName === entry.displayName) {
      skipped += 1;
      continue;
    }
    const newPath = await uniqueEditingPath(mediaDir, newName);
    try {
      if (await pathExists(entry.editingPath)) {
        await rename(entry.editingPath, newPath);
      } else {
        await symlink(entry.originalPath, newPath);
      }
      entry.editingPath = newPath;
      entry.displayName = path.basename(newPath);
      entry.updatedAt = nowIso();
      renamed += 1;
    } catch {
      skipped += 1;
    }
  }
  manifest.updatedAt = nowIso();
  await writeEditingManifest(slug, manifest);
  return { renamed, skipped, manifest };
}

/** 检测 editing 目录下已知剪辑工程文件 */
export async function detectProjectFiles(slug: string): Promise<Array<{ name: string; path: string; app: string }>> {
  const editingDir = editingDirFor(slug);
  const projectFilesDir = path.join(editingDir, "project-files");
  const known: Array<{ ext: string; app: string }> = [
    { ext: ".prproj", app: "Premiere Pro" },
    { ext: ".drp", app: "DaVinci Resolve" },
    { ext: ".fcpbundle", app: "Final Cut Pro" },
    { ext: ".fcpxml", app: "Final Cut Pro" },
    { ext: ".capcut", app: "剪映" },
    { ext: ".draft", app: "剪映" },
  ];
  const results: Array<{ name: string; path: string; app: string }> = [];
  const searchDirs = [projectFilesDir, editingDir];
  for (const dir of searchDirs) {
    if (!(await pathExists(dir))) continue;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        const match = known.find((k) => k.ext === ext);
        if (match) {
          results.push({ name: e.name, path: path.join(dir, e.name), app: match.app });
        }
      }
    } catch { /* ignore */ }
  }
  return results;
}

/** 统计 manifest 概况（紧凑一行信息用） */
export function summarizeManifest(manifest: EditingManifest | null): {
  total: number;
  video: number;
  audio: number;
  image: number;
  proxyReady: number;
  proxyRecommended: number;
  originalBytes: number;
  proxyBytes: number;
  missingSource: number;
} {
  if (!manifest) {
    return { total: 0, video: 0, audio: 0, image: 0, proxyReady: 0, proxyRecommended: 0, originalBytes: 0, proxyBytes: 0, missingSource: 0 };
  }
  let video = 0, audio = 0, image = 0, proxyReady = 0, proxyRecommended = 0, originalBytes = 0, proxyBytes = 0;
  for (const e of manifest.entries) {
    if (e.type === "video") video += 1;
    else if (e.type === "audio") audio += 1;
    else if (e.type === "image") image += 1;
    originalBytes += e.sizeBytes;
    if (e.proxyStatus === "ready") {
      proxyReady += 1;
      proxyBytes += e.proxySizeBytes || 0;
    }
    if (e.proxyStatus === "recommended" || e.proxyStatus === "queued" || e.proxyStatus === "generating") {
      proxyRecommended += 1;
    }
  }
  return {
    total: manifest.entries.length,
    video,
    audio,
    image,
    proxyReady,
    proxyRecommended,
    originalBytes,
    proxyBytes,
    missingSource: 0,
  };
}

/** 按 ShotTask / 朝向 / 来源目录对视频进行虚拟分组（仅返回分组视图，不创建目录） */
export function groupVideoEntries(
  manifest: EditingManifest | null,
): {
  byShot: Map<string, EditingManifestEntry[]>;
  byOrientation: Map<string, EditingManifestEntry[]>;
  bySourceDir: Map<string, EditingManifestEntry[]>;
} {
  const byShot = new Map<string, EditingManifestEntry[]>();
  const byOrientation = new Map<string, EditingManifestEntry[]>();
  const bySourceDir = new Map<string, EditingManifestEntry[]>();
  if (!manifest) return { byShot, byOrientation, bySourceDir };
  for (const e of manifest.entries) {
    if (e.type !== "video") continue;
    const shotKey = e.shotTaskId ? `镜头 #${String(e.shotOrder ?? 0).padStart(2, "0")}` : "未关联镜头";
    const arr = byShot.get(shotKey) || [];
    arr.push(e);
    byShot.set(shotKey, arr);

    const oriKey = e.orientation || "未知";
    const arr2 = byOrientation.get(oriKey) || [];
    arr2.push(e);
    byOrientation.set(oriKey, arr2);

    const dir = path.dirname(e.originalPath);
    const arr3 = bySourceDir.get(dir) || [];
    arr3.push(e);
    bySourceDir.set(dir, arr3);
  }
  return { byShot, byOrientation, bySourceDir };
}

export { editingDirFor, manifestPathFor, classifyType as classifyEditingType };
export type { EditingManifest, EditingManifestEntry };
