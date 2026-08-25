/** 快速素材检查 — 批量检测剪辑清单中素材的健康问题
 *
 * 检查项：
 * - 文件不存在
 * - 文件大小 0
 * - ffprobe 失败
 * - 无视频流
 * - duration 异常（<0.5s 或 >4h）
 * - resolution 异常（任一边 <16 或 >8192）
 * - codec 无法读取
 * - Proxy stale
 *
 * 不做图表。一行信息 + 异常项列表。 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { readEditingManifest } from "./editingPrepBuilder.js";

interface ProbeResult {
  ok: boolean;
  hasVideoStream: boolean;
  duration?: number;
  width?: number;
  height?: number;
  codec?: string;
  error?: string;
}

function probeAsset(filePath: string): Promise<ProbeResult> {
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
      resolve({ ok: false, hasVideoStream: false, error: "ffprobe 超时" });
    }, 8000);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, hasVideoStream: false, error: err.message });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, hasVideoStream: false, error: `ffprobe 退出码 ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(out) as { streams?: Array<{ codec_type?: string; duration?: string; width?: number; height?: number; codec_name?: string }>; format?: { duration?: string } };
        const vs = parsed.streams?.find((s) => s.codec_type === "video");
        const d = Number(vs?.duration || parsed.format?.duration || 0);
        resolve({
          ok: true,
          hasVideoStream: !!vs,
          duration: isNaN(d) ? undefined : d,
          width: vs?.width,
          height: vs?.height,
          codec: vs?.codec_name,
        });
      } catch (err) {
        resolve({ ok: false, hasVideoStream: false, error: err instanceof Error ? err.message : "解析失败" });
      }
    });
  });
}

export interface AssetCheckIssue {
  assetId: string;
  displayName: string;
  originalPath: string;
  type: string;
  issues: string[];
  severity: "warning" | "error";
}

export interface AssetCheckResult {
  total: number;
  okCount: number;
  issueCount: number;
  issues: AssetCheckIssue[];
}

export async function checkEditingAssets(slug: string): Promise<AssetCheckResult> {
  const manifest = await readEditingManifest(slug);
  if (!manifest) return { total: 0, okCount: 0, issueCount: 0, issues: [] };

  const issues: AssetCheckIssue[] = [];
  let okCount = 0;

  for (const entry of manifest.entries) {
    const entryIssues: string[] = [];
    let severity: "warning" | "error" = "warning";

    // 文件不存在
    let exists = true;
    try {
      const s = await stat(entry.originalPath);
      if (s.size === 0) {
        entryIssues.push("文件大小为 0");
        severity = "error";
      }
    } catch {
      exists = false;
      entryIssues.push("文件不存在");
      severity = "error";
    }

    // 视频类素材做 ffprobe 检查
    if (exists && entry.type === "video") {
      const probe = await probeAsset(entry.originalPath);
      if (!probe.ok) {
        entryIssues.push(`ffprobe 失败：${probe.error || "未知"}`);
        severity = "error";
      } else {
        if (!probe.hasVideoStream) {
          entryIssues.push("无视频流");
          severity = "error";
        }
        if (probe.duration !== undefined) {
          if (probe.duration < 0.5) {
            entryIssues.push(`duration 异常 (${probe.duration.toFixed(2)}s)`);
          } else if (probe.duration > 4 * 3600) {
            entryIssues.push(`duration 异常 (${(probe.duration / 3600).toFixed(1)}h)`);
          }
        }
        if (probe.width !== undefined && probe.height !== undefined) {
          if (probe.width < 16 || probe.height < 16) {
            entryIssues.push(`分辨率异常 (${probe.width}x${probe.height})`);
          } else if (probe.width > 8192 || probe.height > 8192) {
            entryIssues.push(`分辨率异常 (${probe.width}x${probe.height})`);
          }
        }
        if (!probe.codec) {
          entryIssues.push("codec 无法读取");
        }
      }
    }

    // symlink 失效
    if (!entry.symlinkOk) {
      entryIssues.push("symlink 未创建");
    }

    // Proxy stale
    if (entry.proxyStale) {
      entryIssues.push("Proxy 已过期（源文件已变化）");
    }

    if (entryIssues.length > 0) {
      issues.push({
        assetId: entry.assetId,
        displayName: entry.displayName,
        originalPath: entry.originalPath,
        type: entry.type,
        issues: entryIssues,
        severity,
      });
    } else {
      okCount += 1;
    }
  }

  return {
    total: manifest.entries.length,
    okCount,
    issueCount: issues.length,
    issues,
  };
}
