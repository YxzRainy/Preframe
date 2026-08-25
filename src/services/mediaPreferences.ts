/** 素材监听目录配置 — .piance/media-preferences.json，原子写入
 * 支持多目录、启用/停用、Finder 原生选择。全局一次性配置，不按项目重复设置。 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type { MediaPreferences, MediaWatchedDirectory } from "../types/mediaAsset.js";

const FILE_NAME = "media-preferences.json";

interface MediaPreferencesStoreData {
  preferences: MediaPreferences;
  updatedAt: string;
}

function normalizeDirectories(value: unknown): MediaWatchedDirectory[] {
  const result: MediaWatchedDirectory[] = [];
  const seenPath = new Set<string>();
  const seenId = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const p = typeof rec.path === "string" ? rec.path.trim() : "";
        if (!p || seenPath.has(p)) continue;
        const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : createId("mdir");
        seenPath.add(p);
        seenId.add(id);
        result.push({ id, path: p, enabled: rec.enabled !== false });
      } else if (typeof item === "string" && item.trim()) {
        const p = item.trim();
        if (seenPath.has(p)) continue;
        seenPath.add(p);
        const id = createId("mdir");
        seenId.add(id);
        result.push({ id, path: p, enabled: true });
      }
    }
  }
  return result;
}

function normalizePreferences(value: unknown): MediaPreferences {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    watchedDirectories: normalizeDirectories(rec.watchedDirectories),
  };
}

export async function readMediaPreferences(): Promise<MediaPreferences> {
  const data = await readAtomicJson<MediaPreferencesStoreData>(FILE_NAME, {
    preferences: normalizePreferences(undefined),
    updatedAt: nowIso(),
  });
  return normalizePreferences(data.preferences);
}

/** 写入配置的输入（id 可缺省，由 normalizeDirectories 生成） */
export interface MediaPreferencesInput {
  watchedDirectories?: Array<{ id?: string; path: string; enabled?: boolean }>;
}

export async function writeMediaPreferences(
  input: MediaPreferencesInput,
): Promise<MediaPreferences> {
  const current = await readMediaPreferences();
  const merged: MediaPreferences = {
    watchedDirectories: input.watchedDirectories
      ? normalizeDirectories(input.watchedDirectories)
      : current.watchedDirectories,
  };
  await writeAtomicJson<MediaPreferencesStoreData>(FILE_NAME, {
    preferences: merged,
    updatedAt: nowIso(),
  });
  return merged;
}

/** 添加一个监听目录（去重） */
export async function addWatchedDirectory(dirPath: string): Promise<MediaPreferences> {
  const prefs = await readMediaPreferences();
  const trimmed = dirPath.trim();
  if (!trimmed) throw new Error("目录路径不能为空。");
  if (prefs.watchedDirectories.some((d) => d.path === trimmed)) {
    return prefs;
  }
  const next: MediaWatchedDirectory[] = [
    ...prefs.watchedDirectories,
    { id: createId("mdir"), path: trimmed, enabled: true },
  ];
  return writeMediaPreferences({ watchedDirectories: next });
}

/** 删除一个监听目录 */
export async function removeWatchedDirectory(id: string): Promise<MediaPreferences> {
  const prefs = await readMediaPreferences();
  return writeMediaPreferences({
    watchedDirectories: prefs.watchedDirectories.filter((d) => d.id !== id),
  });
}

/** 启用/停用一个监听目录 */
export async function toggleWatchedDirectory(id: string, enabled: boolean): Promise<MediaPreferences> {
  const prefs = await readMediaPreferences();
  return writeMediaPreferences({
    watchedDirectories: prefs.watchedDirectories.map((d) =>
      d.id === id ? { ...d, enabled } : d,
    ),
  });
}
