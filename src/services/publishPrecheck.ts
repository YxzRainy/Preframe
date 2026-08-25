/** 发布前自动预检 — 只阻止真正无法继续的问题，其余仅警告 */

import { stat } from "node:fs/promises";
import path from "node:path";

import { PLATFORM_PUBLISH_PROFILES, type PublisherPlatform } from "../types/publisher.js";
import { isBackendUrlConfigured } from "./publishContentReader.js";
import type { PrecheckResult } from "../types/publishSession.js";

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm"]);

async function fileExists(p: string | undefined): Promise<boolean> {
  if (!p || !p.trim()) return false;
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface PrecheckInput {
  videoPath: string;
  targets: Array<{ platform: PublisherPlatform; title: string; description: string; thumbnailPath?: string }>;
  enabledPlatforms: PublisherPlatform[];
  projectReadOk: boolean;
}

export async function precheckSession(input: PrecheckInput): Promise<PrecheckResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 视频
  const videoExists = await fileExists(input.videoPath);
  let videoFormatValid = false;
  if (videoExists) {
    const ext = path.extname(input.videoPath).toLowerCase();
    videoFormatValid = ALLOWED_VIDEO_EXTS.has(ext);
    if (!videoFormatValid) errors.push(`视频格式 ${ext || "未知"} 不在支持范围（mp4/mov/m4v/webm）`);
  } else {
    errors.push("视频文件不存在");
  }

  // 启用平台
  const enabledPlatformCount = input.enabledPlatforms.length;
  if (enabledPlatformCount === 0) errors.push("未启用任何平台");

  // 标题（任一启用平台有标题即视为有）
  const titlePresent = input.targets.some((t) => t.title.trim().length > 0);
  if (!titlePresent) warnings.push("所有平台标题为空，可在会话中编辑补充");

  // 封面（存在路径时校验文件）
  let coverExists: boolean | undefined;
  const coverTargets = input.targets.filter((t) => t.thumbnailPath && t.thumbnailPath.trim());
  if (coverTargets.length > 0) {
    coverExists = await fileExists(coverTargets[0].thumbnailPath);
    if (!coverExists) warnings.push("封面文件不存在（不影响发布，可后续补充）");
  }

  // 后台 URL
  const backendUrlConfigured = input.enabledPlatforms.every((p) => isBackendUrlConfigured(p));
  if (!backendUrlConfigured) {
    const missing = input.enabledPlatforms.filter((p) => !isBackendUrlConfigured(p));
    warnings.push(`以下平台未配置官方后台 URL，需手动打开：${missing.map((p) => PLATFORM_PUBLISH_PROFILES[p].label).join("、")}`);
  }

  // 项目读取
  if (!input.projectReadOk) {
    warnings.push("项目读取失败，文案需手动填写");
  }

  // 文案完全相同仅警告
  const enabledTargets = input.targets.filter((t) => input.enabledPlatforms.includes(t.platform));
  if (enabledTargets.length > 1) {
    const sigs = enabledTargets.map((t) => `${t.title.trim()}|||${t.description.trim()}`);
    const allSame = sigs.every((s) => s === sigs[0]);
    if (allSame && sigs[0] !== "|||") {
      warnings.push("各平台文案完全相同，建议根据平台差异调整");
    }
  }

  const level = errors.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ok";

  return {
    level,
    videoExists,
    videoFormatValid,
    titlePresent,
    enabledPlatformCount,
    coverExists,
    backendUrlConfigured,
    projectReadOk: input.projectReadOk,
    warnings,
    errors,
  };
}

export function precheckSummary(result: PrecheckResult): string {
  if (result.level === "ok") return "预检通过";
  if (result.level === "blocked") return `无法继续：${result.errors.join("；")}`;
  return `可继续（${result.warnings.length} 项警告）`;
}
