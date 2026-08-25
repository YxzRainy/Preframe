/** 发布前检查 — 仅检查本地资源与表单，不调用平台、不调用登录、不调用 Cookie。 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { PLATFORM_PUBLISH_PROFILES, type PreparationCheckResult, type PreparationTargetCheck, type PublishPreparation, type PreparationCheckLevel } from "../types/publisher.js";
import { listAccounts } from "./publisherAccountStore.js";

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm"]);

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function fileExists(p: string | undefined): Promise<boolean> {
  if (!p || !p.trim()) return false;
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function levelOrder(level: PreparationCheckLevel): number {
  return level === "blocked" ? 2 : level === "warning" ? 1 : 0;
}

function aggregateLevel(targets: PreparationTargetCheck[], videoExists: boolean): PreparationCheckLevel {
  if (!videoExists) return "blocked";
  if (targets.some((t) => t.level === "blocked")) return "blocked";
  if (targets.some((t) => t.level === "warning")) return "warning";
  return "ready";
}

export async function checkPreparation(prep: PublishPreparation): Promise<PreparationCheckResult> {
  const videoExists = await fileExists(prep.videoPath);
  let videoSizeLabel: string | undefined;
  let videoExt: string | undefined;
  if (videoExists) {
    try {
      const s = await stat(prep.videoPath);
      videoSizeLabel = formatBytes(s.size);
      videoExt = path.extname(prep.videoPath).toLowerCase();
    } catch {
      /* ignore */
    }
  }
  const videoFormatValid = isVideoFormatAllowed(videoExt);
  const accounts = await listAccounts().catch(() => []);

  const targets: PreparationTargetCheck[] = [];
  for (const t of prep.targets) {
    if (!t.enabled) continue;
    const profile = PLATFORM_PUBLISH_PROFILES[t.platform];
    const errors: string[] = [];
    const warnings: string[] = [];
    let coverPresent = false;
    const accountConfigured = accounts.some((account) => account.enabled && account.platform === t.platform && account.status === "logged_in");

    // 标题
    if (profile.titleRequired && !t.title.trim()) {
      errors.push("标题为空");
    }
    // 描述
    if (profile.descriptionSupported && !t.description.trim()) {
      warnings.push("描述为空，部分平台可能要求填写");
    }
    // 标签
    if (profile.tagsSupported && t.tags.length === 0) {
      warnings.push("未填写标签");
    }
    // 封面
    if (profile.thumbnailSupported) {
      if (t.thumbnailPath?.trim()) {
        coverPresent = await fileExists(t.thumbnailPath);
        if (!coverPresent) errors.push("封面文件不存在");
      } else {
        warnings.push("未设置封面，将在平台后台确认默认封面");
      }
    }
    // 视频已在顶层检查，这里仅提示
    if (!videoExists) errors.push("视频文件不存在");
    else if (!videoFormatValid) errors.push(`不支持的视频格式：${videoExt || "未知"}`);
    if (!accountConfigured) warnings.push("未检测到已登录账号，发布时需在官方后台确认登录");

    let level: PreparationCheckLevel = "ready";
    if (errors.length > 0) level = "blocked";
    else if (warnings.length > 0) level = "warning";

    targets.push({ targetId: t.id, platform: t.platform, level, errors, warnings, coverPresent, accountConfigured });
  }

  // 不同平台仍使用完全相同的空白内容时给出警告
  let blankDuplicationWarning: string | undefined;
  const enabledTargets = prep.targets.filter((t) => t.enabled);
  if (enabledTargets.length > 1) {
    const sigs = enabledTargets.map((t) => `${t.title.trim()}|||${t.description.trim()}|||${t.tags.join(",")}`);
    const allBlank = sigs.every((s) => s === "|||");
    const allSame = sigs.every((s) => s === sigs[0]);
    if (allBlank) {
      blankDuplicationWarning = "所有平台内容均为空，请至少填写母版后再检查。";
    } else if (allSame) {
      blankDuplicationWarning = "所有平台内容完全相同，建议根据平台差异分别调整。";
    }
  }

  const level = aggregateLevel(targets, videoExists);
  // 空白重复仅在非 blocked 时升级为 warning
  const finalLevel: PreparationCheckLevel =
    level === "ready" && blankDuplicationWarning ? "warning" : level;

  return {
    level: finalLevel,
    videoExists,
    videoFormatValid,
    videoSizeLabel,
    videoExt,
    targets,
    blankDuplicationWarning,
  };
}

export function isVideoFormatAllowed(ext: string | undefined): boolean {
  return !!ext && ALLOWED_VIDEO_EXTS.has(ext);
}

export { formatBytes, levelOrder };
