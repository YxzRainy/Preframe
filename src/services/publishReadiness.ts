/** 发布就绪度检查 — 自动检测项目是否真的"可发布"
 *
 * 结果只分 ready / warning / blocked。
 * blocked 仅允许：
 *   - 视频不存在
 *   - 视频仍在导出（文件未稳定）
 *   - 没有任何启用平台
 * 其他全部作为 warning，不制造人为门槛。
 */

import { stat } from "node:fs/promises";
import path from "node:path";

import { isBackendUrlConfigured } from "./platformVariantBuilder.js";
import type { PublisherPlatform } from "../types/publisher.js";
import type { PublishReadiness, PublishSession, PublishSessionTarget } from "../types/publishSession.js";

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm"]);

async function fileExists(p: string): Promise<boolean> {
  if (!p || !p.trim()) return false;
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface ReadinessInput {
  videoPath: string;
  /** 文件是否已稳定（连续两次扫描 size+mtime 一致）；未传入时只看存在性 */
  videoStable?: boolean;
  targets: PublishSessionTarget[];
  enabledPlatforms: PublisherPlatform[];
  projectMatchClear: boolean;
}

export async function computeReadiness(input: ReadinessInput): Promise<PublishReadiness> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 视频
  const videoExists = await fileExists(input.videoPath);
  let videoFormatValid = false;
  if (videoExists) {
    const ext = path.extname(input.videoPath).toLowerCase();
    videoFormatValid = ALLOWED_VIDEO_EXTS.has(ext);
    if (!videoFormatValid) warnings.push(`视频格式 ${ext || "未知"} 不在支持范围`);
  }
  const videoStable = input.videoStable !== false;

  // blocked 条件 1：视频不存在
  if (!videoExists) {
    blockers.push("视频文件不存在");
  } else if (!videoStable) {
    // blocked 条件 2：视频仍在导出
    blockers.push("视频仍在导出，请等待完成");
  }

  // blocked 条件 3：没有任何启用平台
  if (input.enabledPlatforms.length === 0) {
    blockers.push("未启用任何平台");
  }

  // 平台后台 URL
  const backendUrlConfigured = input.enabledPlatforms.every((p) => isBackendUrlConfigured(p));
  if (!backendUrlConfigured) {
    const missing = input.enabledPlatforms.filter((p) => !isBackendUrlConfigured(p));
    warnings.push(`以下平台未配置官方后台 URL：${missing.join("、")}`);
  }

  // 项目匹配是否明确
  if (!input.projectMatchClear) {
    warnings.push("项目匹配不明确，建议确认关联项目");
  }

  // 至少一个平台有标题
  const hasTitle = input.targets.some((t) => t.title.trim().length > 0);
  if (!hasTitle) warnings.push("所有平台标题为空");

  // 发布文案是否存在
  const hasDescription = input.targets.some((t) => t.description.trim().length > 0);
  if (!hasDescription) warnings.push("所有平台发布文案为空");

  // 封面是否存在（不阻断）
  const coverPresent = await (async () => {
    const coverTargets = input.targets.filter((t) => t.thumbnailPath && t.thumbnailPath.trim());
    if (coverTargets.length === 0) return false;
    const coverPath = coverTargets[0].thumbnailPath;
    return coverPath ? fileExists(coverPath) : false;
  })();
  if (!coverPresent) warnings.push("未找到封面（不影响发布，可在会话中手动选择）");

  const level = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";

  return {
    level,
    videoExists,
    videoStable: videoExists && videoStable,
    projectMatchClear: input.projectMatchClear,
    hasTitle,
    hasDescription,
    coverPresent,
    backendUrlConfigured,
    blockers,
    warnings,
  };
}

/** 从已存在的会话重新计算就绪度（用于会话刷新） */
export async function computeReadinessForSession(session: PublishSession): Promise<PublishReadiness> {
  const enabledPlatforms = session.targets.map((t) => t.platform);
  return computeReadiness({
    videoPath: session.videoPath,
    videoStable: true,
    targets: session.targets,
    enabledPlatforms,
    projectMatchClear: Boolean(session.projectSlug),
  });
}
