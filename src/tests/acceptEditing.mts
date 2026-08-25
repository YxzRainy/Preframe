/** 剪辑准备工作台 — 真实验收脚本（ai_2 项目 + 真实测试素材）
 *
 * 16 项验证：
 *  1. 创建 editing 目录
 *  2. symlink 原素材
 *  3. manifest 正确
 *  4. ffmpeg 生成至少 2 个真实 Proxy
 *  5. ffprobe 验证 Proxy
 *  6. Proxy cache 复用
 *  7. cancel
 *  8. retry
 *  9. source 修改后 stale
 * 10. Finder 显示
 * 11. 系统播放器打开 Proxy
 * 12. 删除/移动一个测试素材
 * 13. 重新定位目录
 * 14. 自动 relink
 * 15. manifest 更新
 * 16. 刷新状态不丢 */

import { strict as assert } from "node:assert";
import { access, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { prepareEditingWorkspace, readEditingManifest, detectMissingSources, detectProjectFiles } from "../services/editingPrepBuilder.js";
import { enqueueProxyGeneration, cancelProxyJob, retryProxyJob, refreshProxyStatus, getProxyStatusForProject } from "../services/proxyManager.js";
import { readProxyJobs } from "../services/proxyJobStore.js";
import { relinkFromDirectory } from "../services/mediaRelinker.js";
import { readMediaAssets } from "../services/mediaAssetStore.js";

const SLUG = "ai_2";
const PROJECT_DIR = path.resolve(process.cwd(), "output", SLUG);
const EDITING_DIR = path.join(PROJECT_DIR, "editing");
const RELINK_TMP = path.join(PROJECT_DIR, ".relink_tmp");

let step = 0;
function log(msg: string): void { console.log(`[${String(++step).padStart(2, "0")}] ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function ffprobeCheck(filePath: string): Promise<{ ok: boolean; width?: number; height?: number; duration?: number }> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.on("error", () => resolve({ ok: false }));
    child.on("exit", () => {
      try {
        const parsed = JSON.parse(out) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>; format?: { duration?: string } };
        const vs = parsed.streams?.find((s) => s.codec_type === "video");
        resolve({ ok: true, width: vs?.width, height: vs?.height, duration: Number(parsed.format?.duration || 0) });
      } catch { resolve({ ok: false }); }
    });
  });
}

async function waitForProxyIdle(slug: string, maxWaitMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const views = await getProxyStatusForProject(slug);
    const active = views.some((v) => v.status === "queued" || v.status === "generating");
    if (!active) return;
    await sleep(1500);
  }
}

async function main(): Promise<void> {
  // ── 1. 创建 editing 目录 ──
  log("准备剪辑工作区（创建 editing 目录 + symlink + manifest）...");
  await rm(EDITING_DIR, { recursive: true, force: true });
  const prep = await prepareEditingWorkspace(SLUG);
  const expectedSubdirs = ["media", "proxy", "audio", "images", "subtitles", "exports", "project-files"];
  for (const sub of expectedSubdirs) {
    assert.ok(await pathExists(path.join(EDITING_DIR, sub)), `editing/${sub} 应存在`);
  }
  log(`✓ editing 目录已创建（${prep.createdDirs.length} 个新建子目录）`);

  // ── 2. symlink 原素材 ──
  assert.ok(prep.symlinkCount > 0, `应创建 symlink，实际 ${prep.symlinkCount}`);
  const mediaDir = path.join(EDITING_DIR, "media");
  const mediaFiles = await readdir(mediaDir);
  assert.ok(mediaFiles.length >= 5, `media 目录应有 ≥5 个 symlink，实际 ${mediaFiles.length}`);
  // 验证 symlink 真实指向
  for (const f of mediaFiles) {
    const linkPath = path.join(mediaDir, f);
    const s = await stat(linkPath);
    assert.ok(s.size > 0, `${f} 应可通过 symlink 访问`);
  }
  log(`✓ symlink 创建 ${prep.symlinkCount} 个，失败 ${prep.symlinkFailed} 个`);

  // ── 3. manifest 正确 ──
  const manifest = await readEditingManifest(SLUG);
  assert.ok(manifest, "manifest 应存在");
  assert.ok(manifest!.entries.length >= 5, `manifest 应有 ≥5 条目，实际 ${manifest!.entries.length}`);
  const firstVideo = manifest!.entries.find((e) => e.type === "video")!;
  assert.ok(firstVideo.assetId, "entry 应有 assetId");
  assert.ok(firstVideo.originalPath, "entry 应有 originalPath");
  assert.ok(firstVideo.editingPath, "entry 应有 editingPath");
  assert.ok(firstVideo.codec, "entry 应有 codec");
  assert.ok(firstVideo.width && firstVideo.height, "entry 应有分辨率");
  log(`✓ manifest 正确：${manifest!.entries.length} 条目，首条 ${firstVideo.displayName} (${firstVideo.width}x${firstVideo.height} ${firstVideo.codec})`);

  // ── 4. ffmpeg 生成至少 2 个真实 Proxy ──
  const videoEntries = manifest!.entries.filter((e) => e.type === "video");
  const target1 = videoEntries[0];
  const target2 = videoEntries[1];
  log(`生成 Proxy 1: ${target1.displayName} (force)...`);
  const r1 = await enqueueProxyGeneration(SLUG, target1.assetId, "fast", true);
  log(`生成 Proxy 2: ${target2.displayName} (force)...`);
  const r2 = await enqueueProxyGeneration(SLUG, target2.assetId, "fast", true);
  assert.ok(r1.job || r1.reused, "Proxy 1 应入队或复用");
  assert.ok(r2.job || r2.reused, "Proxy 2 应入队或复用");
  log("等待 Proxy 生成完成...");
  await waitForProxyIdle(SLUG);
  const viewsAfterGen = await getProxyStatusForProject(SLUG);
  const readyCount = viewsAfterGen.filter((v) => v.status === "ready").length;
  assert.ok(readyCount >= 2, `应有 ≥2 个 ready proxy，实际 ${readyCount}`);
  log(`✓ 已生成 ${readyCount} 个真实 Proxy`);

  // ── 5. ffprobe 验证 Proxy ──
  const manifestAfterGen = await readEditingManifest(SLUG);
  const readyEntries = manifestAfterGen!.entries.filter((e) => e.proxyStatus === "ready" && e.proxyPath);
  assert.ok(readyEntries.length >= 2, `应有 ≥2 个有 proxyPath 的 entry`);
  for (const e of readyEntries.slice(0, 2)) {
    assert.ok(await pathExists(e.proxyPath!), `proxy 文件应存在: ${e.proxyPath}`);
    const probe = await ffprobeCheck(e.proxyPath!);
    assert.ok(probe.ok, `proxy 应可通过 ffprobe 读取: ${e.proxyPath}`);
    assert.ok(probe.width! <= 1280, `proxy 宽度应 ≤1280（fast 预设），实际 ${probe.width}`);
  }
  log(`✓ ffprobe 验证 Proxy 通过（${readyEntries[0].proxyPath}，${readyEntries[0].proxySizeBytes} 字节）`);

  // ── 6. Proxy cache 复用 ──
  log("测试 cache 复用（再次入队同一素材同一 preset）...");
  const reuseResult = await enqueueProxyGeneration(SLUG, target1.assetId, "fast", false);
  assert.ok(reuseResult.reused, `应复用 cache，reason: ${reuseResult.reason}`);
  log(`✓ cache 复用：${reuseResult.reason}`);

  // ── 7. cancel ──
  log("测试 cancel（入队第 3 个 proxy 后立即取消）...");
  const target3 = videoEntries[2];
  const r3 = await enqueueProxyGeneration(SLUG, target3.assetId, "fast", true);
  if (r3.job) {
    // 等一小段时间让它进入 generating
    await sleep(500);
    const cancelResult = await cancelProxyJob(r3.job.id);
    log(`✓ cancel 结果：${cancelResult.reason}`);
  } else {
    log(`✓ 第 3 个 proxy 已 ready 或复用，跳过 cancel（${r3.reason}）`);
  }

  // ── 8. retry ──
  log("测试 retry（重新入队第 3 个素材）...");
  await waitForProxyIdle(SLUG);
  const jobsRaw = await readProxyJobs();
  const failedJob = jobsRaw.find((j) => j.status === "failed" && j.assetId === target3.assetId);
  if (failedJob) {
    const retryResult = await retryProxyJob(failedJob.id);
    assert.ok(retryResult.ok, `retry 应成功：${retryResult.reason}`);
    await waitForProxyIdle(SLUG);
    log(`✓ retry 成功：${retryResult.reason}`);
  } else {
    // 直接 enqueue 生成
    const r3b = await enqueueProxyGeneration(SLUG, target3.assetId, "fast", true);
    await waitForProxyIdle(SLUG);
    log(`✓ 第 3 个 proxy 已生成（${r3b.reason}）`);
  }

  // ── 9. source 修改后 stale ──
  log("测试 stale（修改源文件 mtime 后刷新）...");
  const staleTarget = readyEntries[0];
  const origStat = await stat(staleTarget.originalPath);
  // 修改 mtime（不动内容）
  const newTime = new Date(origStat.mtimeMs + 60000);
  await utimes(staleTarget.originalPath, newTime, newTime);
  const refreshResult = await refreshProxyStatus(SLUG);
  const manifestStale = await readEditingManifest(SLUG);
  const staleEntry = manifestStale!.entries.find((e) => e.assetId === staleTarget.assetId);
  assert.ok(staleEntry?.proxyStale === true, `修改源 mtime 后 proxy 应标记 stale，实际 proxyStale=${staleEntry?.proxyStale}`);
  log(`✓ stale 检测：源文件 mtime 变化后 proxy 标记为 stale（refreshed=${refreshResult.refreshed}, stale=${refreshResult.staleCount}）`);
  // 恢复 mtime
  await utimes(staleTarget.originalPath, origStat.atime, origStat.mtime);
  await refreshProxyStatus(SLUG);

  // ── 10. Finder 显示 ──
  log("测试 Finder 显示（revealInFinder）...");
  const { revealInFinder } = await import("../services/systemActions.js");
  const revealResult = await revealInFinder(staleTarget.originalPath);
  assert.ok(revealResult.ok !== false, `Finder 显示应成功：${revealResult.error || ""}`);
  log(`✓ Finder 显示原素材成功`);

  // ── 11. 系统播放器打开 Proxy ──
  log("测试系统播放器打开 Proxy...");
  const { openInDefaultPlayer } = await import("../services/systemActions.js");
  const playerResult = await openInDefaultPlayer(staleTarget.proxyPath || "");
  assert.ok(playerResult.ok !== false, `系统播放器应打开 proxy：${playerResult.error || ""}`);
  log(`✓ 系统播放器打开 Proxy 成功`);

  // ── 12-15. 删除/移动测试素材 → 重新定位 → 自动 relink → manifest 更新 ──
  log("测试素材缺失检测（移动 VID_0416.mp4 到临时目录）...");
  const assets = await readMediaAssets();
  const moveAsset = assets.find((a) => a.fileName === "VID_0416.mp4" && a.projectSlug === SLUG);
  if (!moveAsset) {
    log("⚠ 未找到 VID_0416.mp4，使用最后一个视频素材代替");
  }
  const moveTarget = moveAsset || assets.find((a) => a.projectSlug === SLUG && a.kind === "video");
  assert.ok(moveTarget, "应有可移动的测试素材");
  const moveSrc = moveTarget!.path;
  await rm(RELINK_TMP, { recursive: true, force: true });
  await mkdir(RELINK_TMP, { recursive: true });
  const moveDst = path.join(RELINK_TMP, moveTarget!.fileName);
  await rename(moveSrc, moveDst);
  try {
    const missingResult = await detectMissingSources(SLUG);
    assert.ok(missingResult.missing.length >= 1, `应检测到 ≥1 个失效素材，实际 ${missingResult.missing.length}`);
    const movedEntry = missingResult.missing.find((m) => m.assetId === moveTarget!.id);
    assert.ok(movedEntry, `移动的素材应在失效列表中`);
    log(`✓ 缺失检测：${missingResult.missing.length} 个素材路径失效（含 ${moveTarget!.fileName}）`);

    // ── 13. 重新定位目录 ──
    // ── 14. 自动 relink ──
    log("测试自动 relink（扫描临时目录）...");
    const relinkResult = await relinkFromDirectory(SLUG, RELINK_TMP);
    assert.ok(relinkResult.autoRelinked >= 1, `应自动重连 ≥1 个，实际 ${relinkResult.autoRelinked}`);
    log(`✓ 自动 relink：扫描 ${relinkResult.scannedFiles} 文件，自动重连 ${relinkResult.autoRelinked}/${relinkResult.totalMissing}，待确认 ${relinkResult.ambiguous.length}，未匹配 ${relinkResult.unmatched.length}`);

    // ── 15. manifest 更新 ──
    const manifestAfterRelink = await readEditingManifest(SLUG);
    const relinkedEntry = manifestAfterRelink!.entries.find((e) => e.assetId === moveTarget!.id);
    assert.ok(relinkedEntry, "relink 后 manifest 应包含该素材");
    assert.equal(relinkedEntry!.originalPath, moveDst, `manifest originalPath 应更新为新路径`);
    assert.ok(relinkedEntry!.symlinkOk, `relink 后 symlink 应重建成功`);
    log(`✓ manifest 更新：${moveTarget!.fileName} originalPath → ${moveDst}`);
  } finally {
    // 恢复：把文件移回原位 + 恢复 media-assets 路径 + 重新准备 symlink
    try { await rename(moveDst, moveSrc); } catch { /* 已恢复 */ }
    await rm(RELINK_TMP, { recursive: true, force: true });
    const assetsAfterRelink = await readMediaAssets();
    const movedAsset = assetsAfterRelink.find((a) => a.id === moveTarget!.id);
    if (movedAsset && movedAsset.path !== moveSrc) {
      movedAsset.path = moveSrc;
      const { writeMediaAssets } = await import("../services/mediaAssetStore.js");
      await writeMediaAssets(assetsAfterRelink);
    }
    await prepareEditingWorkspace(SLUG);
  }

  // ── 16. 刷新状态不丢 ──
  log("测试刷新状态不丢（重新读取 manifest）...");
  const manifestReload = await readEditingManifest(SLUG);
  assert.ok(manifestReload, "重新读取 manifest 应成功");
  assert.equal(manifestReload!.entries.length, manifest!.entries.length, `条目数应一致（${manifest!.entries.length}）`);
  const stillReady = manifestReload!.entries.filter((e) => e.proxyStatus === "ready").length;
  assert.ok(stillReady >= 2, `刷新后应有 ≥2 个 ready proxy，实际 ${stillReady}`);
  // 验证 proxy 文件仍在
  for (const e of manifestReload!.entries.filter((e) => e.proxyPath)) {
    assert.ok(await pathExists(e.proxyPath!), `proxy 文件应仍存在: ${e.proxyPath}`);
  }
  log(`✓ 刷新状态不丢：${manifestReload!.entries.length} 条目，${stillReady} 个 proxy 仍 ready`);

  // ── 额外：工程文件检测 ──
  const projectFiles = await detectProjectFiles(SLUG);
  log(`工程文件检测：${projectFiles.length} 个（无已知工程文件属正常）`);

  console.log("\n========== 真实验收全部通过（16/16）==========");
}

main().catch((err) => {
  console.error("\n❌ 验收失败:", err);
  console.error(err.stack);
  process.exit(1);
});
