/** 素材资产存储 — .piance/media-assets.json，原子写入
 * 轻量指纹去重（path + size + normalizedName + 首尾 64KB hash），不读完整大文件。
 * 同一素材改名/移动后迁移记录，不生成重复资产。 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type { MediaAsset } from "../types/mediaAsset.js";

const FILE_NAME = "media-assets.json";

interface MediaAssetsStoreData {
  assets: MediaAsset[];
  updatedAt: string;
}

export async function readMediaAssets(): Promise<MediaAsset[]> {
  const data = await readAtomicJson<MediaAssetsStoreData>(FILE_NAME, {
    assets: [],
    updatedAt: nowIso(),
  });
  return Array.isArray(data.assets) ? (data.assets as MediaAsset[]) : [];
}

export async function writeMediaAssets(assets: MediaAsset[]): Promise<void> {
  await writeAtomicJson<MediaAssetsStoreData>(FILE_NAME, {
    assets,
    updatedAt: nowIso(),
  });
}

export function findByPath(assets: MediaAsset[], filePath: string): MediaAsset | undefined {
  return assets.find((a) => a.path === filePath);
}

export function findById(assets: MediaAsset[], id: string): MediaAsset | undefined {
  return assets.find((a) => a.id === id);
}

export interface DuplicateMatch {
  /** 已存在的记录 */
  record: MediaAsset;
  /** 是否为 hash 强匹配（改名/移动后的同一文件） */
  byHash: boolean;
}

/** 查找重复资产：先按路径，再按 hash+size，最后按规范化名+size */
export function findDuplicate(
  assets: MediaAsset[],
  input: {
    path: string;
    sizeBytes: number;
    normalizedName: string;
    hashHead?: string;
    hashTail?: string;
  },
): DuplicateMatch | undefined {
  // 1. 路径完全一致
  const byPath = assets.find((a) => a.path === input.path);
  if (byPath) return { record: byPath, byHash: false };

  // 2. hash + size 强匹配（改名/移动后的同一文件）
  if (input.hashHead && input.hashTail) {
    const byHash = assets.find(
      (a) =>
        a.hashHead === input.hashHead &&
        a.hashTail === input.hashTail &&
        a.sizeBytes === input.sizeBytes,
    );
    if (byHash) return { record: byHash, byHash: true };
  }

  // 3. 规范化名 + size 弱匹配
  const byName = assets.find(
    (a) => a.normalizedName === input.normalizedName && a.sizeBytes === input.sizeBytes,
  );
  if (byName) return { record: byName, byHash: false };

  return undefined;
}

/** 插入或更新资产记录。返回 { asset, isNew } */
export async function upsertAsset(
  input: Omit<MediaAsset, "id" | "scannedAt"> & { id?: string },
): Promise<{ asset: MediaAsset; isNew: boolean }> {
  const assets = await readMediaAssets();
  const now = nowIso();
  const existingIdx = input.id
    ? assets.findIndex((a) => a.id === input.id)
    : assets.findIndex((a) => a.path === input.path);

  if (existingIdx >= 0) {
    const existing = assets[existingIdx];
    const updated: MediaAsset = { ...existing, ...input, id: existing.id, scannedAt: now };
    assets[existingIdx] = updated;
    await writeMediaAssets(assets);
    return { asset: updated, isNew: false };
  }

  const asset: MediaAsset = {
    ...input,
    id: input.id || createId("asset"),
    scannedAt: now,
  };
  assets.push(asset);
  await writeMediaAssets(assets);
  return { asset, isNew: true };
}

/** 迁移资产路径（改名/移动后保留已有状态） */
export async function migrateAssetPath(
  oldPath: string,
  newPath: string,
  patch: Partial<MediaAsset>,
): Promise<MediaAsset | undefined> {
  const assets = await readMediaAssets();
  const idx = assets.findIndex((a) => a.path === oldPath);
  if (idx < 0) return undefined;
  const migrated: MediaAsset = {
    ...assets[idx],
    ...patch,
    path: newPath,
    scannedAt: nowIso(),
  };
  assets[idx] = migrated;
  await writeMediaAssets(assets);
  return migrated;
}

/** 批量更新资产（用于项目匹配结果回写） */
export async function updateAssets(updates: MediaAsset[]): Promise<MediaAsset[]> {
  const assets = await readMediaAssets();
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const u of updates) {
    byId.set(u.id, { ...u, scannedAt: nowIso() });
  }
  const next = Array.from(byId.values());
  await writeMediaAssets(next);
  return next;
}

/** 清理已不存在文件的资产记录（可选，不自动调用） */
export async function pruneMissingAssets(existingPaths: Set<string>): Promise<number> {
  const assets = await readMediaAssets();
  const before = assets.length;
  const kept = assets.filter((a) => existingPaths.has(a.path));
  if (kept.length !== before) {
    await writeMediaAssets(kept);
  }
  return before - kept.length;
}
