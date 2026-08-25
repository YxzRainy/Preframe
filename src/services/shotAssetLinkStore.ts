/** 镜头-素材关系存储 — .piance/shot-asset-links.json，原子写入
 * 明确的单一关系存储，不写入 project.json（避免并发写冲突）。
 * 不移动/复制原始文件，仅记录关联路径与置信度。 */

import { createId, nowIso, readAtomicJson, writeAtomicJson } from "./atomicJson.js";
import type {
  ShotAssetLink,
  ShotAssetLinkSource,
  ShotAssetLinkStatus,
} from "../types/mediaAsset.js";

const FILE_NAME = "shot-asset-links.json";

interface ShotAssetLinksStoreData {
  links: ShotAssetLink[];
  updatedAt: string;
}

export async function readLinks(): Promise<ShotAssetLink[]> {
  const data = await readAtomicJson<ShotAssetLinksStoreData>(FILE_NAME, {
    links: [],
    updatedAt: nowIso(),
  });
  return Array.isArray(data.links) ? (data.links as ShotAssetLink[]) : [];
}

export async function writeLinks(links: ShotAssetLink[]): Promise<void> {
  await writeAtomicJson<ShotAssetLinksStoreData>(FILE_NAME, {
    links,
    updatedAt: nowIso(),
  });
}

export async function getLinksForProject(projectSlug: string): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  return links.filter((l) => l.projectSlug === projectSlug && l.status !== "rejected");
}

export async function getLinksForShot(
  projectSlug: string,
  shotTaskId: string,
): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  return links.filter(
    (l) => l.projectSlug === projectSlug && l.shotTaskId === shotTaskId && l.status !== "rejected",
  );
}

/** 创建 suggested 关系（自动匹配产生）。已存在同 asset+shot 的则跳过。 */
export async function addSuggestedLinks(
  inputs: Array<{
    projectSlug: string;
    shotTaskId: string;
    assetId: string;
    confidence: number;
    source: ShotAssetLinkSource;
  }>,
): Promise<ShotAssetLink[]> {
  if (inputs.length === 0) return readLinks();
  const links = await readLinks();
  const now = nowIso();
  const byKey = new Map(links.map((l) => [`${l.projectSlug}|${l.shotTaskId}|${l.assetId}`, l]));

  for (const input of inputs) {
    const key = `${input.projectSlug}|${input.shotTaskId}|${input.assetId}`;
    const existing = byKey.get(key);
    if (existing) {
      // 已存在：更新置信度（但不覆盖 confirmed/rejected 状态）
      if (existing.status === "suggested") {
        existing.confidence = input.confidence;
        existing.source = input.source;
        existing.updatedAt = now;
      }
    } else {
      const link: ShotAssetLink = {
        id: createId("link"),
        projectSlug: input.projectSlug,
        shotTaskId: input.shotTaskId,
        assetId: input.assetId,
        confidence: input.confidence,
        source: input.source,
        status: "suggested",
        createdAt: now,
      };
      links.push(link);
      byKey.set(key, link);
    }
  }
  await writeLinks(links);
  return links;
}

/** 确认单个关系（suggested → confirmed），并标记为主素材（若该镜头无主素材） */
export async function confirmLink(linkId: string, primary?: boolean): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  const now = nowIso();
  const target = links.find((l) => l.id === linkId);
  if (!target) return links;
  target.status = "confirmed";
  target.updatedAt = now;
  // 若设为主素材，取消该镜头其他主素材
  if (primary !== false) {
    target.primary = true;
    for (const l of links) {
      if (l.id !== linkId && l.projectSlug === target.projectSlug && l.shotTaskId === target.shotTaskId) {
        l.primary = false;
      }
    }
  } else {
    target.primary = false;
  }
  await writeLinks(links);
  return links;
}

/** 批量确认关系 */
export async function batchConfirmLinks(linkIds: string[]): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  const now = nowIso();
  const idSet = new Set(linkIds);
  // 按 shotTaskId 分组，每组第一个确认的设为主素材
  const primarySet = new Set<string>();
  for (const l of links) {
    if (idSet.has(l.id) && l.status !== "confirmed" && !primarySet.has(l.shotTaskId)) {
      primarySet.add(l.shotTaskId);
    }
  }
  for (const l of links) {
    if (idSet.has(l.id)) {
      l.status = "confirmed";
      l.updatedAt = now;
      if (primarySet.has(l.shotTaskId)) {
        l.primary = true;
        // 取消同镜头其他主素材
        for (const other of links) {
          if (other.id !== l.id && other.projectSlug === l.projectSlug && other.shotTaskId === l.shotTaskId) {
            other.primary = false;
          }
        }
      } else {
        l.primary = false;
      }
    }
  }
  await writeLinks(links);
  return links;
}

/** 拒绝关系 */
export async function rejectLink(linkId: string): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  const target = links.find((l) => l.id === linkId);
  if (target) {
    target.status = "rejected";
    target.updatedAt = nowIso();
    target.primary = false;
  }
  await writeLinks(links);
  return links;
}

/** 重新指定素材到另一个镜头（取消旧关系，新建 confirmed 关系） */
export async function reassignLink(
  linkId: string,
  newShotTaskId: string,
): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  const now = nowIso();
  const target = links.find((l) => l.id === linkId);
  if (!target) return links;
  // 旧关系标记 rejected
  target.status = "rejected";
  target.updatedAt = now;
  target.primary = false;
  // 新建 confirmed 关系
  const newLink: ShotAssetLink = {
    id: createId("link"),
    projectSlug: target.projectSlug,
    shotTaskId: newShotTaskId,
    assetId: target.assetId,
    confidence: 100,
    source: "manual",
    status: "confirmed",
    primary: true,
    createdAt: now,
    updatedAt: now,
  };
  // 取消新镜头其他主素材
  for (const l of links) {
    if (l.shotTaskId === newShotTaskId && l.projectSlug === target.projectSlug) {
      l.primary = false;
    }
  }
  links.push(newLink);
  await writeLinks(links);
  return links;
}

/** 手动为镜头指定素材（新建 confirmed 主素材关系） */
export async function manualLink(
  projectSlug: string,
  shotTaskId: string,
  assetId: string,
): Promise<ShotAssetLink> {
  const links = await readLinks();
  const now = nowIso();
  // 取消该镜头其他主素材
  for (const l of links) {
    if (l.projectSlug === projectSlug && l.shotTaskId === shotTaskId) {
      l.primary = false;
    }
  }
  // 若已存在同 asset+shot 关系则升级为 confirmed
  const existing = links.find(
    (l) => l.projectSlug === projectSlug && l.shotTaskId === shotTaskId && l.assetId === assetId,
  );
  if (existing) {
    existing.status = "confirmed";
    existing.primary = true;
    existing.source = "manual";
    existing.confidence = 100;
    existing.updatedAt = now;
    await writeLinks(links);
    return existing;
  }
  const link: ShotAssetLink = {
    id: createId("link"),
    projectSlug,
    shotTaskId,
    assetId,
    confidence: 100,
    source: "manual",
    status: "confirmed",
    primary: true,
    createdAt: now,
    updatedAt: now,
  };
  links.push(link);
  await writeLinks(links);
  return link;
}

/** 标记镜头不需要素材 */
export async function markShotNotNeeded(
  projectSlug: string,
  shotTaskId: string,
): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  // 移除该镜头的 suggested 关系（保留 confirmed/rejected 历史）
  const filtered = links.filter(
    (l) => !(l.projectSlug === projectSlug && l.shotTaskId === shotTaskId && l.status === "suggested"),
  );
  await writeLinks(filtered);
  return filtered;
}

/**
 * 分镜重建后迁移关系到新的镜头 id。无法匹配到现存镜头的活动关系会被拒绝，
 * 保留为历史记录但不再参与缺素材和剪辑准备统计。
 */
export async function remapShotLinks(
  projectSlug: string,
  idMap: ReadonlyMap<string, string>,
  validShotTaskIds: ReadonlySet<string>,
): Promise<ShotAssetLink[]> {
  const links = await readLinks();
  const now = nowIso();

  for (const link of links) {
    if (link.projectSlug !== projectSlug || link.status === "rejected") continue;
    const nextId = idMap.get(link.shotTaskId) || (validShotTaskIds.has(link.shotTaskId) ? link.shotTaskId : undefined);
    if (!nextId) {
      link.status = "rejected";
      link.primary = false;
      link.updatedAt = now;
      continue;
    }
    if (nextId !== link.shotTaskId) {
      link.shotTaskId = nextId;
      link.updatedAt = now;
    }
  }

  const activeByKey = new Map<string, ShotAssetLink>();
  for (const link of links) {
    if (link.projectSlug !== projectSlug || link.status === "rejected") continue;
    const key = `${link.shotTaskId}|${link.assetId}`;
    const existing = activeByKey.get(key);
    if (!existing) {
      activeByKey.set(key, link);
      continue;
    }
    const keep = existing.status === "confirmed" || link.status !== "confirmed" ? existing : link;
    const reject = keep === existing ? link : existing;
    reject.status = "rejected";
    reject.primary = false;
    reject.updatedAt = now;
    activeByKey.set(key, keep);
  }

  await writeLinks(links);
  return links.filter((link) => link.projectSlug === projectSlug && link.status !== "rejected");
}

/** 删除指定项目的所有关系（项目删除时调用） */
export async function clearLinksForProject(projectSlug: string): Promise<void> {
  const links = await readLinks();
  await writeLinks(links.filter((l) => l.projectSlug !== projectSlug));
}

export type { ShotAssetLink, ShotAssetLinkSource, ShotAssetLinkStatus };
