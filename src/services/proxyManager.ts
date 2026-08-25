/** Proxy 管理 — 推荐规则、预设、cache key、stale 判断、ffmpeg 生成（最多 2 并发）
 *
 * 边界：
 * - 不阻塞 HTTP：生成在后台 spawn ffmpeg，进度写入 proxyJobStore
 * - ffmpeg 使用 spawn 参数数组，禁止 exec / shell 拼接
 * - 同时最多 2 个 ffmpeg，避免 Mac 被打满
 * - cache key = sourcePath|size|mtime|preset，未变化直接复用
 * - 源文件变化后标记 stale，不重复生成已就绪的 proxy（除非用户强制）
 * - 无 ffprobe/ffmpeg 时不阻塞，降级为推荐状态不可生成 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveProjectDirectory } from "./projectManager.js";
import { readEditingManifest, updateManifestProxyFields } from "./editingPrepBuilder.js";
import {
  addJob,
  findByCacheKey,
  getJob,
  getJobsForProject,
  readProxyJobs,
  resetJobForRetry,
  updateJob,
} from "./proxyJobStore.js";
import { nowIso } from "./atomicJson.js";
import type { EditingManifestEntry } from "../types/editingManifest.js";
import type { ProxyJob, ProxyPreset, ProxyStatus } from "../types/editingManifest.js";

// ── 预设（第一版固定两个，不暴露大型配置表单）──

export interface ProxyPresetConfig {
  id: ProxyPreset;
  name: string;
  /** 最大边像素 */
  maxEdge: number;
  crf: number;
  encoderPreset: string;
  audioBitrate: string;
  videoCodec: string;
  audioCodec: string;
}

export const PROXY_PRESETS: Record<ProxyPreset, ProxyPresetConfig> = {
  fast: {
    id: "fast",
    name: "快速代理",
    maxEdge: 1280,
    crf: 28,
    encoderPreset: "veryfast",
    audioBitrate: "96k",
    videoCodec: "libx264",
    audioCodec: "aac",
  },
  high: {
    id: "high",
    name: "高质量代理",
    maxEdge: 1920,
    crf: 23,
    encoderPreset: "medium",
    audioBitrate: "128k",
    videoCodec: "libx264",
    audioCodec: "aac",
  },
};

const DEFAULT_PRESET: ProxyPreset = "fast";
const MAX_CONCURRENT = 2;

// ── ffprobe / ffmpeg 能力检测 ──

let ffmpegAvailable: boolean | null = null;
function detectFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return Promise.resolve(ffmpegAvailable);
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      ffmpegAvailable = false;
      resolve(false);
    }, 4000);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffmpegAvailable = false;
      resolve(false);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffmpegAvailable = code === 0;
      resolve(ffmpegAvailable);
    });
  });
}

// ── 推荐规则 ──

export interface ProxyRecommendation {
  status: ProxyStatus;
  reasons: string[];
}

/** 根据素材 metadata 判断是否需要 Proxy。
 * 建议生成：HEVC/H265、4K+、高码率、10bit、特殊 codec
 * 可能无需：普通 H264、1080p、低码率
 * 用户始终可手动生成，不会因「无需」而禁止操作。 */
export function recommendProxy(asset: {
  codec?: string;
  width?: number;
  height?: number;
  duration?: number;
  sizeBytes: number;
  bitrate?: number;
}): ProxyRecommendation {
  const reasons: string[] = [];
  let recommended = false;

  const codec = (asset.codec || "").toLowerCase();
  // HEVC / H265 / 特殊 codec
  if (codec === "hevc" || codec === "h265" || codec === "h265" || codec === "vp9" || codec === "av1" || codec === "prores" || codec === "dnxhd") {
    recommended = true;
    reasons.push(`${codec.toUpperCase()} 编码`);
  }

  // 4K+（任一边 ≥ 3840）
  const maxDim = Math.max(asset.width || 0, asset.height || 0);
  if (maxDim >= 3840) {
    recommended = true;
    reasons.push(`4K+ 分辨率 (${maxDim}px)`);
  } else if (maxDim >= 2560) {
    // 2.5K 以上轻度推荐
    reasons.push(`高分辨率 (${maxDim}px)`);
    recommended = true;
  }

  // 高码率：估算 bitrate = sizeBytes * 8 / duration
  const duration = asset.duration;
  if (duration && duration > 0 && asset.sizeBytes > 0) {
    const bitrateMbps = (asset.sizeBytes * 8) / duration / 1_000_000;
    if (bitrateMbps >= 40) {
      recommended = true;
      reasons.push(`高码率 (~${bitrateMbps.toFixed(1)} Mbps)`);
    } else if (bitrateMbps >= 20) {
      reasons.push(`中码率 (~${bitrateMbps.toFixed(1)} Mbps)`);
    }
  } else if (asset.bitrate && asset.bitrate >= 40_000_000) {
    recommended = true;
    reasons.push("高码率");
  }

  if (recommended) {
    return { status: "recommended", reasons: reasons.length ? reasons : ["建议生成 Proxy"] };
  }

  // 普通 H264 + 1080p + 低码率 → 可能无需
  if (codec === "h264" && maxDim <= 1920) {
    return { status: "not_needed", reasons: ["H264 1080p，可直接剪辑"] };
  }
  return { status: "not_needed", reasons: ["格式常见，可能无需 Proxy"] };
}

// ── cache key / stale ──

/** sourcePath|size|mtime|preset 的 sha256，用于 proxy 复用 */
export function proxyCacheKey(
  sourcePath: string,
  size: number,
  mtime: number,
  preset: ProxyPreset,
): string {
  return createHash("sha256")
    .update(`${sourcePath}|${size}|${mtime}|${preset}`)
    .digest("hex")
    .slice(0, 16);
}

/** 源文件指纹：size|mtime（用于 stale 判断） */
export function sourceFingerprint(size: number, mtime: number): string {
  return `${size}|${mtime}`;
}

/** 判断 proxy 是否 stale：源文件 size/mtime 与生成时不同 */
export function isProxyStale(entry: EditingManifestEntry): boolean {
  if (!entry.proxySourceFingerprint || !entry.proxyPath) return false;
  // 仅做声明式判断；实际文件检查在 refreshProxyStatus 中
  return entry.proxyStale === true;
}

// ── 路径 ──

function proxyDirFor(slug: string): string {
  return path.join(resolveProjectDirectory(slug), "editing", "proxy");
}

function proxyFileName(assetId: string, preset: ProxyPreset, ext: string): string {
  const safe = assetId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-24);
  return `${safe}_${preset}${ext}`;
}

export function proxyPathFor(slug: string, assetId: string, preset: ProxyPreset, sourceExt: string): string {
  const ext = /\.(mp4|mov|m4v|webm)$/i.test(sourceExt) ? ".mp4" : ".mp4";
  return path.join(proxyDirFor(slug), proxyFileName(assetId, preset, ext));
}

// ── 刷新 manifest 中 proxy 状态（结合源文件实际 size/mtime 判断 stale）──

export async function refreshProxyStatus(slug: string): Promise<{
  refreshed: number;
  staleCount: number;
}> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return { refreshed: 0, staleCount: 0 };
  let refreshed = 0;
  let staleCount = 0;
  for (const entry of manifest.entries) {
    if (entry.type !== "video") continue;
    if (!entry.proxyStatus || entry.proxyStatus === "not_needed" || entry.proxyStatus === "recommended") {
      // 推荐状态可由 recommendProxy 重新计算
      const rec = recommendProxy(entry);
      if (entry.proxyStatus !== rec.status) {
        await updateManifestProxyFields(slug, entry.assetId, { proxyStatus: rec.status });
        refreshed += 1;
      }
      continue;
    }
    // 已有 proxy：检查源文件是否变化 → stale
    if (entry.proxySourceFingerprint && entry.proxyPath) {
      try {
        const s = await stat(entry.originalPath);
        const fp = sourceFingerprint(s.size, s.mtimeMs);
        const stale = fp !== entry.proxySourceFingerprint;
        if (stale !== entry.proxyStale) {
          await updateManifestProxyFields(slug, entry.assetId, { proxyStale: stale });
          refreshed += 1;
        }
        if (stale) staleCount += 1;
      } catch {
        // 源文件丢失：标记 stale
        if (!entry.proxyStale) {
          await updateManifestProxyFields(slug, entry.assetId, { proxyStale: true });
          refreshed += 1;
        }
        staleCount += 1;
      }
    }
  }
  return { refreshed, staleCount };
}

// ── 入队 / 批量 / 取消 / 重试 ──

export interface EnqueueResult {
  job: ProxyJob | null;
  reused: boolean;
  reason: string;
}

/** 入队单个 proxy 生成（带 cache 复用 + stale 判断） */
export async function enqueueProxyGeneration(
  slug: string,
  assetId: string,
  preset: ProxyPreset = DEFAULT_PRESET,
  force = false,
): Promise<EnqueueResult> {
  const ffmpegOk = await detectFfmpeg();
  if (!ffmpegOk) {
    return { job: null, reused: false, reason: "未检测到 ffmpeg，无法生成 Proxy。" };
  }

  const manifest = await readEditingManifest(slug);
  const entry = manifest?.entries.find((e) => e.assetId === assetId);
  if (!entry) return { job: null, reused: false, reason: "素材不在剪辑清单中。" };
  if (entry.type !== "video") return { job: null, reused: false, reason: "非视频素材，跳过 Proxy。" };

  // 检查源文件
  let srcStat;
  try {
    srcStat = await stat(entry.originalPath);
  } catch {
    return { job: null, reused: false, reason: "源素材文件不存在。" };
  }

  const cacheKey = proxyCacheKey(entry.originalPath, srcStat.size, srcStat.mtimeMs, preset);

  // cache 复用：同 cacheKey 已有 ready 的 proxy
  if (!force) {
    const cached = await findByCacheKey(cacheKey);
    if (cached && cached.proxyPath) {
      try {
        await access(cached.proxyPath);
        await updateManifestProxyFields(slug, assetId, {
          proxyStatus: "ready",
          proxyPreset: preset,
          proxyPath: cached.proxyPath,
          proxySizeBytes: (await stat(cached.proxyPath)).size,
          proxyStale: false,
          proxySourceFingerprint: sourceFingerprint(srcStat.size, srcStat.mtimeMs),
        });
        return { job: cached, reused: true, reason: "命中 cache，复用已生成 Proxy。" };
      } catch { /* cache 文件丢失，重新生成 */ }
    }
  }

  // 已有 ready proxy 且未 stale：无需重复
  if (!force && entry.proxyStatus === "ready" && !entry.proxyStale && entry.proxyPreset === preset) {
    return { job: null, reused: true, reason: "Proxy 已就绪且未过期。" };
  }

  const proxyPath = proxyPathFor(slug, assetId, preset, entry.originalFileName);
  await mkdir(path.dirname(proxyPath), { recursive: true });

  const job = await addJob({
    projectSlug: slug,
    assetId,
    sourcePath: entry.originalPath,
    preset,
    proxyPath,
    cacheKey,
  });
  await updateManifestProxyFields(slug, assetId, {
    proxyStatus: "queued",
    proxyPreset: preset,
    proxyPath,
    proxyStale: false,
  });

  void tickRunner();
  return { job, reused: false, reason: "已加入生成队列。" };
}

export type BatchScope = "recommended" | "all" | "shots";

export interface BatchEnqueueResult {
  enqueued: number;
  reused: number;
  skipped: number;
  results: EnqueueResult[];
}

/** 批量入队 */
export async function batchEnqueueProxy(
  slug: string,
  scope: BatchScope = "recommended",
  preset: ProxyPreset = DEFAULT_PRESET,
): Promise<BatchEnqueueResult> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return { enqueued: 0, reused: 0, skipped: 0, results: [] };

  const targets: EditingManifestEntry[] = [];
  for (const entry of manifest.entries) {
    if (entry.type !== "video") continue;
    if (scope === "all") {
      targets.push(entry);
    } else if (scope === "recommended") {
      const rec = recommendProxy(entry);
      if (rec.status === "recommended") targets.push(entry);
    } else if (scope === "shots") {
      if (entry.shotTaskId) targets.push(entry);
    }
  }

  const results: EnqueueResult[] = [];
  let enqueued = 0;
  let reused = 0;
  let skipped = 0;
  for (const entry of targets) {
    const r = await enqueueProxyGeneration(slug, entry.assetId, preset);
    results.push(r);
    if (r.job) enqueued += 1;
    else if (r.reused) reused += 1;
    else skipped += 1;
  }
  return { enqueued, reused, skipped, results };
}

/** 取消任务（终止 ffmpeg） */
export async function cancelProxyJob(jobId: string): Promise<{ ok: boolean; reason: string }> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, reason: "任务不存在。" };
  if (job.status !== "queued" && job.status !== "generating") {
    return { ok: false, reason: `任务状态为 ${job.status}，无法取消。` };
  }
  // 终止 ffmpeg 进程
  const child = activeChildren.get(jobId);
  if (child) {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    activeChildren.delete(jobId);
  }
  await updateJob(jobId, { status: "failed", errorMessage: "已取消", finishedAt: nowIso() });
  await updateManifestProxyFields(job.projectSlug, job.assetId, { proxyStatus: "failed" });
  // 重新计算下一个排队任务
  void tickRunner();
  return { ok: true, reason: "已取消。" };
}

/** 重试失败任务 */
export async function retryProxyJob(jobId: string): Promise<{ ok: boolean; reason: string }> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, reason: "任务不存在。" };
  if (job.status !== "failed") return { ok: false, reason: "仅失败任务可重试。" };
  await resetJobForRetry(jobId);
  await updateManifestProxyFields(job.projectSlug, job.assetId, { proxyStatus: "queued" });
  void tickRunner();
  return { ok: true, reason: "已重新入队。" };
}

// ── 后台并发执行器（模块级单例，长生命周期 server 中持续运转）──

const activeChildren = new Map<string, ChildProcess>();
let activeCount = 0;
let ticking = false;

async function tickRunner(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    while (activeCount < MAX_CONCURRENT) {
      const jobs = await readProxyJobs();
      const next = jobs.find((j) => j.status === "queued");
      if (!next) break;
      activeCount += 1;
      void runProxyJob(next);
    }
  } finally {
    ticking = false;
  }
}

async function runProxyJob(job: ProxyJob): Promise<void> {
  const preset = PROXY_PRESETS[job.preset];
  await updateJob(job.id, { status: "generating", progress: 0, startedAt: nowIso(), errorMessage: undefined });
  await updateManifestProxyFields(job.projectSlug, job.assetId, { proxyStatus: "generating" });

  // 获取时长（用于进度计算）
  const durationSec = await getDuration(job.sourcePath);

  try {
    await mkdir(path.dirname(job.proxyPath), { recursive: true });
  } catch { /* ignore */ }

  const args = buildFfmpegArgs(job.sourcePath, job.proxyPath, preset);
  const result = await runFfmpeg(args, job.id, durationSec);

  if (result.canceled) {
    activeCount -= 1;
    void tickRunner();
    return;
  }

  if (result.code === 0) {
    let proxySize = 0;
    try { proxySize = (await stat(job.proxyPath)).size; } catch { /* ignore */ }
    let srcSize = 0;
    let srcMtime = 0;
    try {
      const s = await stat(job.sourcePath);
      srcSize = s.size;
      srcMtime = s.mtimeMs;
    } catch { /* ignore */ }
    await updateJob(job.id, {
      status: "ready",
      progress: 100,
      finishedAt: nowIso(),
    });
    await updateManifestProxyFields(job.projectSlug, job.assetId, {
      proxyStatus: "ready",
      proxyPreset: job.preset,
      proxyPath: job.proxyPath,
      proxySizeBytes: proxySize,
      proxyStale: false,
      proxySourceFingerprint: sourceFingerprint(srcSize, srcMtime),
    });
  } else {
    await updateJob(job.id, {
      status: "failed",
      errorMessage: result.stderrTail || `ffmpeg 退出码 ${result.code}`,
      finishedAt: nowIso(),
    });
    await updateManifestProxyFields(job.projectSlug, job.assetId, { proxyStatus: "failed" });
  }

  activeCount -= 1;
  if (activeCount < 0) activeCount = 0;
  void tickRunner();
}

function buildFfmpegArgs(source: string, output: string, preset: ProxyPresetConfig): string[] {
  const maxEdge = preset.maxEdge;
  // scale 到 maxEdge×maxEdge 框内保持比例，再确保偶数边（x264 要求）
  const vf = `scale=${maxEdge}:${maxEdge}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  return [
    "-y",
    "-i", source,
    "-vf", vf,
    "-c:v", preset.videoCodec,
    "-preset", preset.encoderPreset,
    "-crf", String(preset.crf),
    "-c:a", preset.audioCodec,
    "-b:a", preset.audioBitrate,
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    output,
  ];
}

interface FfmpegRunResult {
  code: number | null;
  canceled: boolean;
  stderrTail: string;
}

function runFfmpeg(args: string[], jobId: string, durationSec: number): Promise<FfmpegRunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess;
    try {
      child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: -1, canceled: false, stderrTail: err instanceof Error ? err.message : String(err) });
      return;
    }
    activeChildren.set(jobId, child);

    let stdoutBuf = "";
    let stderrBuf = "";
    let lastProgress = 0;

    const finish = (code: number | null, canceled: boolean) => {
      if (settled) return;
      settled = true;
      activeChildren.delete(jobId);
      resolve({ code, canceled, stderrTail: stderrBuf.slice(-800) });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      // 解析 -progress 输出：out_time_us=...
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const m = line.match(/^out_time_us=(\d+)/);
        if (m && durationSec > 0) {
          const us = Number(m[1]);
          const pct = Math.min(99, Math.max(0, Math.round((us / 1_000_000 / durationSec) * 100)));
          if (pct > lastProgress) {
            lastProgress = pct;
            void updateJob(jobId, { progress: pct });
          }
        }
        if (line.startsWith("progress=end")) {
          void updateJob(jobId, { progress: 99 });
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
    });

    child.on("error", (err) => {
      finish(-1, false);
      void updateJob(jobId, { errorMessage: err.message });
    });

    child.on("exit", (code) => {
      finish(code, false);
    });
  });
}

async function getDuration(filePath: string): Promise<number> {
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
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(0);
    });
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

// ── 查询：合并 manifest + jobs 状态（带进度）──

export interface ProxyStatusView {
  assetId: string;
  status: ProxyStatus;
  preset?: ProxyPreset;
  proxyPath?: string;
  progress: number;
  stale?: boolean;
  jobId?: string;
  errorMessage?: string;
  reasons?: string[];
}

export async function getProxyStatusForProject(slug: string): Promise<ProxyStatusView[]> {
  const [manifest, jobs] = await Promise.all([
    readEditingManifest(slug),
    getJobsForProject(slug),
  ]);
  if (!manifest) return [];
  const jobByAsset = new Map<string, ProxyJob>();
  for (const j of jobs) {
    // 取最新一条
    const cur = jobByAsset.get(j.assetId);
    if (!cur || j.createdAt > cur.createdAt) jobByAsset.set(j.assetId, j);
  }

  const views: ProxyStatusView[] = [];
  for (const entry of manifest.entries) {
    if (entry.type !== "video") continue;
    const job = jobByAsset.get(entry.assetId);
    let status: ProxyStatus = entry.proxyStatus || recommendProxy(entry).status;
    let progress = 0;
    let jobId: string | undefined;
    let errorMessage: string | undefined;
    // 若有活跃 job，以 job 状态为准
    if (job && (job.status === "generating" || job.status === "queued")) {
      status = job.status;
      progress = job.progress;
      jobId = job.id;
    } else if (job && job.status === "failed" && entry.proxyStatus !== "ready") {
      status = "failed";
      errorMessage = job.errorMessage;
      jobId = job.id;
    }
    const reasons = status === "recommended" || status === "not_needed" ? recommendProxy(entry).reasons : undefined;
    views.push({
      assetId: entry.assetId,
      status,
      preset: entry.proxyPreset,
      proxyPath: entry.proxyPath,
      progress,
      stale: entry.proxyStale,
      jobId,
      errorMessage,
      reasons,
    });
  }
  return views;
}

export { DEFAULT_PRESET, detectFfmpeg };
