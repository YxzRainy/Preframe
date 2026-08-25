/** 发布平台预设 — .piance/publisher-preferences.json，原子写入
 * 支持多目录监听、平台启用/顺序、向后兼容旧 finalVideoDirectory 字段。 */

import { nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import {
  PUBLISHER_PLATFORMS,
  type PublisherPlatform,
} from "../types/publisher.js";
import type { PublisherPreferences, WatchedDirectory } from "../types/publishSession.js";

const FILE_NAME = "publisher-preferences.json";

interface PreferencesStoreData {
  preferences: PublisherPreferences;
  updatedAt: string;
}

const DEFAULT_PLATFORM_ORDER: PublisherPlatform[] = [
  "douyin",
  "xiaohongshu",
  "tencent",
  "bilibili",
  "kuaishou",
  "youtube",
];

const DEFAULT_ENABLED_PLATFORMS: PublisherPlatform[] = [
  "douyin",
  "xiaohongshu",
  "tencent",
  "bilibili",
];

/** 默认成片目录：项目工作区下 final-videos/ */
export function defaultFinalVideoDirectory(): string {
  return "final-videos";
}

function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(value);
}

function normalizePlatformList(value: unknown, fallback: PublisherPlatform[]): PublisherPlatform[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<PublisherPlatform>();
  const result: PublisherPlatform[] = [];
  for (const v of value) {
    if (isPlatform(v) && !seen.has(v)) {
      seen.add(v);
      result.push(v);
    }
  }
  // 补齐缺失的平台（保证 order 完整）
  for (const p of PUBLISHER_PLATFORMS) {
    if (!seen.has(p)) result.push(p);
  }
  return result;
}

/** 规范化监听目录列表：去重、保留 enabled 状态 */
function normalizeWatchedDirectories(value: unknown, legacySingle?: string): WatchedDirectory[] {
  const result: WatchedDirectory[] = [];
  const seen = new Set<string>();

  // 先迁移旧的单目录字段
  if (legacySingle && typeof legacySingle === "string" && legacySingle.trim()) {
    const p = legacySingle.trim();
    if (!seen.has(p)) {
      seen.add(p);
      result.push({ path: p, enabled: true });
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const p = typeof rec.path === "string" ? rec.path.trim() : "";
        if (!p) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        result.push({ path: p, enabled: rec.enabled !== false });
      } else if (typeof item === "string" && item.trim()) {
        const p = item.trim();
        if (seen.has(p)) continue;
        seen.add(p);
        result.push({ path: p, enabled: true });
      }
    }
  }

  // 若没有任何目录，使用默认
  if (result.length === 0) {
    result.push({ path: defaultFinalVideoDirectory(), enabled: true });
  }
  return result;
}

function normalizePreferences(value: unknown): PublisherPreferences {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const enabled = normalizePlatformList(rec.enabledPlatforms, DEFAULT_ENABLED_PLATFORMS);
  const order = normalizePlatformList(rec.platformOrder, DEFAULT_PLATFORM_ORDER);
  const enabledInOrder = enabled.filter((p) => order.includes(p));
  const finalEnabled = enabledInOrder.length > 0 ? enabledInOrder : DEFAULT_ENABLED_PLATFORMS;

  const legacySingle = typeof rec.finalVideoDirectory === "string" ? rec.finalVideoDirectory : undefined;
  const watched = normalizeWatchedDirectories(rec.watchedVideoDirectories, legacySingle);

  return {
    enabledPlatforms: finalEnabled,
    platformOrder: order,
    watchedVideoDirectories: watched,
    finalVideoDirectory: undefined,
  };
}

export async function readPreferences(): Promise<PublisherPreferences> {
  const data = await readAtomicJson<PreferencesStoreData>(FILE_NAME, {
    preferences: normalizePreferences(undefined),
    updatedAt: nowIso(),
  });
  return normalizePreferences(data.preferences);
}

export async function writePreferences(input: Partial<PublisherPreferences>): Promise<PublisherPreferences> {
  const current = await readPreferences();
  const merged: PublisherPreferences = {
    enabledPlatforms: input.enabledPlatforms
      ? normalizePlatformList(input.enabledPlatforms, current.enabledPlatforms)
      : current.enabledPlatforms,
    platformOrder: input.platformOrder
      ? normalizePlatformList(input.platformOrder, current.platformOrder)
      : current.platformOrder,
    watchedVideoDirectories: input.watchedVideoDirectories
      ? normalizeWatchedDirectories(input.watchedVideoDirectories)
      : current.watchedVideoDirectories,
    finalVideoDirectory: undefined,
  };
  // enabled 至少一个
  if (merged.enabledPlatforms.length === 0) {
    merged.enabledPlatforms = DEFAULT_ENABLED_PLATFORMS;
  }
  await writeAtomicJson<PreferencesStoreData>(FILE_NAME, { preferences: merged, updatedAt: nowIso() });
  return merged;
}

/** 仅用于生成不冲突的会话 id（本文件不负责会话，但保留工具） */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
