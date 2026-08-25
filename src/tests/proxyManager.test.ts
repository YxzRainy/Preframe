/** Proxy 管理与剪辑命名 — 纯函数测试
 *
 * 覆盖：
 * - proxy recommendation（HEVC / 4K / 高码率 / 普通 H264）
 * - cache key（确定性 / preset / size / mtime 差异）
 * - stale 判断
 * - symlink 命名（ShotTask 关联 / 未关联 / 特殊字符） */

import { strict as assert } from "node:assert";
import {
  PROXY_PRESETS,
  recommendProxy,
  proxyCacheKey,
  sourceFingerprint,
  isProxyStale,
} from "../services/proxyManager.js";
import { buildDisplayName } from "../services/editingPrepBuilder.js";
import type { EditingManifestEntry } from "../types/editingManifest.js";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── 1. Proxy 推荐规则 ──────────────────────────────────────────
console.log("Proxy recommendation:");

// HEVC → 建议生成
{
  const r = recommendProxy({ codec: "hevc", width: 1920, height: 1080, sizeBytes: 50_000_000, duration: 10 });
  assert.equal(r.status, "recommended");
  assert.ok(r.reasons.some((x) => /HEVC/i.test(x)), "应包含 HEVC 原因");
  ok("HEVC 编码 → recommended");
}

// 4K → 建议生成
{
  const r = recommendProxy({ codec: "h264", width: 3840, height: 2160, sizeBytes: 100_000_000, duration: 10 });
  assert.equal(r.status, "recommended");
  assert.ok(r.reasons.some((x) => /4K/.test(x)), "应包含 4K 原因");
  ok("4K 分辨率 → recommended");
}

// 高码率 → 建议生成（sizeBytes*8/duration ≥ 40 Mbps）
{
  // 50MB / 10s = 40 Mbps
  const r = recommendProxy({ codec: "h264", width: 1920, height: 1080, sizeBytes: 50_000_000, duration: 10 });
  assert.equal(r.status, "recommended");
  assert.ok(r.reasons.some((x) => /高码率/.test(x)), "应包含高码率原因");
  ok("高码率 (~40 Mbps) → recommended");
}

// 普通 H264 + 1080p + 低码率 → 无需
{
  // 5MB / 5s = 8 Mbps
  const r = recommendProxy({ codec: "h264", width: 1080, height: 1920, sizeBytes: 5_000_000, duration: 5 });
  assert.equal(r.status, "not_needed");
  ok("普通 H264 1080p 低码率 → not_needed");
}

// ProRes → 建议生成
{
  const r = recommendProxy({ codec: "prores", width: 1920, height: 1080, sizeBytes: 200_000_000, duration: 10 });
  assert.equal(r.status, "recommended");
  ok("ProRes 编码 → recommended");
}

// 2.5K 轻度推荐
{
  const r = recommendProxy({ codec: "h264", width: 2560, height: 1440, sizeBytes: 10_000_000, duration: 5 });
  assert.equal(r.status, "recommended");
  ok("2.5K 分辨率 → recommended");
}

// ── 2. cache key ──────────────────────────────────────────────
console.log("Cache key:");

{
  const k1 = proxyCacheKey("/a/b.mov", 1000, 123456, "fast");
  const k2 = proxyCacheKey("/a/b.mov", 1000, 123456, "fast");
  assert.equal(k1, k2, "相同输入应产出相同 key");
  ok("确定性：相同输入 → 相同 key");
}

{
  const k1 = proxyCacheKey("/a/b.mov", 1000, 123456, "fast");
  const k2 = proxyCacheKey("/a/b.mov", 1000, 123456, "high");
  assert.notEqual(k1, k2, "不同 preset 应产出不同 key");
  ok("不同 preset → 不同 key");
}

{
  const k1 = proxyCacheKey("/a/b.mov", 1000, 123456, "fast");
  const k2 = proxyCacheKey("/a/b.mov", 2000, 123456, "fast");
  assert.notEqual(k1, k2, "不同 size 应产出不同 key");
  ok("不同 size → 不同 key");
}

{
  const k1 = proxyCacheKey("/a/b.mov", 1000, 123456, "fast");
  const k2 = proxyCacheKey("/a/b.mov", 1000, 999999, "fast");
  assert.notEqual(k1, k2, "不同 mtime 应产出不同 key");
  ok("不同 mtime → 不同 key");
}

{
  const k = proxyCacheKey("/a/b.mov", 1000, 123456, "fast");
  assert.equal(k.length, 16, "cache key 应为 16 字符 hex");
  ok("cache key 长度 = 16");
}

// ── 3. stale 判断 ─────────────────────────────────────────────
console.log("Stale:");

{
  const fp1 = sourceFingerprint(1000, 123456);
  const fp2 = sourceFingerprint(1000, 123456);
  const fp3 = sourceFingerprint(2000, 123456);
  assert.equal(fp1, fp2, "相同 size+mtime → 相同指纹");
  assert.notEqual(fp1, fp3, "不同 size → 不同指纹");
  ok("sourceFingerprint 正确反映 size/mtime 变化");
}

{
  const entry: EditingManifestEntry = {
    assetId: "a1", originalPath: "/x.mov", editingPath: "/y.mov",
    displayName: "x.mov", originalFileName: "x.mov", type: "video",
    sizeBytes: 1000, symlinkOk: true, proxyStale: true,
    proxyPath: "/p.mov", proxySourceFingerprint: "1000|123",
    addedAt: "2026-01-01T00:00:00Z",
  };
  assert.equal(isProxyStale(entry), true, "proxyStale=true 应判定 stale");
  ok("isProxyStale 识别 stale 标记");
}

{
  const entry: EditingManifestEntry = {
    assetId: "a2", originalPath: "/x.mov", editingPath: "/y.mov",
    displayName: "x.mov", originalFileName: "x.mov", type: "video",
    sizeBytes: 1000, symlinkOk: true, proxyStale: false,
    proxyPath: "/p.mov", proxySourceFingerprint: "1000|123",
    addedAt: "2026-01-01T00:00:00Z",
  };
  assert.equal(isProxyStale(entry), false, "proxyStale=false 不应 stale");
  ok("isProxyStale 识别未 stale");
}

{
  const entry: EditingManifestEntry = {
    assetId: "a3", originalPath: "/x.mov", editingPath: "/y.mov",
    displayName: "x.mov", originalFileName: "x.mov", type: "video",
    sizeBytes: 1000, symlinkOk: true,
    addedAt: "2026-01-01T00:00:00Z",
  };
  assert.equal(isProxyStale(entry), false, "无 proxy 字段不应 stale");
  ok("isProxyStale 无 proxy 字段 → false");
}

// ── 4. 预设配置 ───────────────────────────────────────────────
console.log("Presets:");
{
  assert.equal(PROXY_PRESETS.fast.maxEdge, 1280, "快速代理最大边 1280");
  assert.equal(PROXY_PRESETS.high.maxEdge, 1920, "高质量代理最大边 1920");
  assert.equal(PROXY_PRESETS.fast.videoCodec, "libx264", "快速代理 H264");
  assert.equal(PROXY_PRESETS.high.crf < PROXY_PRESETS.fast.crf, true, "高质量 CRF 应更低（更高质量）");
  ok("两个预设配置正确（fast 720p / high 1080p）");
}

// ── 5. symlink 命名 ────────────────────────────────────────────
console.log("Symlink naming:");
{
  const shotTypes = new Map([["task_1", "口播"]]);
  const name = buildDisplayName(
    { originalFileName: "VID_0412.MOV", shotOrder: 1, shotTaskId: "task_1", type: "video" },
    shotTypes, 1,
  );
  assert.equal(name, "S01_口播_VID_0412.MOV", "已关联 ShotTask 应为 S<order>_<shotType>_<base>.ext");
  ok("ShotTask 关联命名：S01_口播_VID_0412.MOV");
}

{
  const name = buildDisplayName(
    { originalFileName: "VID_0413.mp4", type: "video" },
    new Map(), 5,
  );
  assert.equal(name, "MEDIA_005.mp4", "未关联 ShotTask 应为 MEDIA_<序号>.ext");
  ok("未关联命名：MEDIA_005.mp4");
}

{
  const shotTypes = new Map([["task_2", "BROLL/远景"]]);
  const name = buildDisplayName(
    { originalFileName: "clip.mov", shotOrder: 2, shotTaskId: "task_2", type: "video" },
    shotTypes, 1,
  );
  assert.ok(!/[/\\:*?"<>|]/.test(name), "shotType 特殊字符应被替换");
  assert.ok(name.startsWith("S02_"), "应以 S02_ 开头");
  ok("特殊字符 shotType 安全替换");
}

{
  const shotTypes = new Map([["task_3", "镜头"]]);
  const name = buildDisplayName(
    { originalFileName: "VID_0412.MOV", shotOrder: 12, shotTaskId: "task_3", type: "video" },
    shotTypes, 1,
  );
  assert.ok(name.startsWith("S12_"), "order 应补零到 2 位");
  ok("order 补零：S12_");
}

console.log(`\nproxyManager.test: ${passed} 项通过。`);
