/** 素材→项目自动匹配
 *
 * 依据：
 * 1. 素材所在目录名（含项目名/slug）
 * 2. 文件名（含项目主题关键词）
 * 3. 素材导入时间与项目最近活动时间
 * 4. 当前处于 shooting/editing 阶段的项目优先
 * 5. 批次传播：同目录同小时内有素材高置信匹配到项目 A，其他文件提高 A 权重
 *
 * 高置信（score >= AUTO_CONFIRM_THRESHOLD）自动归属；
 * 中低置信最多返回 3 个候选。不要求用户逐个选择项目。 */

import path from "node:path";
import { listProjects } from "./projectManager.js";
import { readProject } from "./projectReader.js";
import { readStage } from "./projectStage.js";
import { readMediaAssets, updateAssets } from "./mediaAssetStore.js";
import type {
  MediaAsset,
  ProjectMatchCandidate,
} from "../types/mediaAsset.js";
import type { ProjectStage } from "./projectStage.js";

const AUTO_CONFIRM_THRESHOLD = 50;
const CANDIDATE_THRESHOLD = 18;
const MAX_CANDIDATES = 3;
const BATCH_WINDOW_MS = 60 * 60 * 1000; // 同一小时

interface ProjectInfo {
  slug: string;
  name: string;
  stage: ProjectStage;
  stageUpdatedAt: string;
  /** 项目目录绝对路径（用于判断素材是否位于项目目录内） */
  directory: string;
  /** 规范化关键词集合（slug + name + topic） */
  keywords: Set<string>;
  topic?: string;
}

interface ProjectSummary {
  slug: string;
  name: string;
  topic?: string;
  directory: string;
}

async function loadProjectSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  const summaries: ProjectSummary[] = [];
  for (const p of projects) {
    try {
      const detail = await readProject(p.name);
      summaries.push({
        slug: p.name,
        name: detail.metadata.projectName || p.name,
        topic: typeof detail.metadata.topic === "string" ? detail.metadata.topic : undefined,
        directory: p.path,
      });
    } catch {
      summaries.push({ slug: p.name, name: p.name, directory: p.path });
    }
  }
  return summaries;
}

async function loadProjectInfos(): Promise<ProjectInfo[]> {
  const summaries = await loadProjectSummaries();
  const infos: ProjectInfo[] = [];
  for (const s of summaries) {
    try {
      const stageCtx = await readStage(s.slug);
      infos.push({
        slug: s.slug,
        name: s.name,
        topic: s.topic,
        directory: s.directory,
        stage: stageCtx.stage,
        stageUpdatedAt: stageCtx.stageUpdatedAt,
        keywords: buildKeywords(s.slug, s.name, s.topic),
      });
    } catch {
      infos.push({
        slug: s.slug,
        name: s.name,
        topic: s.topic,
        directory: s.directory,
        stage: "idea",
        stageUpdatedAt: new Date().toISOString(),
        keywords: buildKeywords(s.slug, s.name, s.topic),
      });
    }
  }
  return infos;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function buildKeywords(slug: string, name: string, topic?: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(slug)) tokens.add(t);
  for (const t of tokenize(name)) tokens.add(t);
  if (topic) for (const t of tokenize(topic)) tokens.add(t);
  return tokens;
}

/** 计算单个素材对单个项目的匹配分数 */
function scoreProject(
  asset: MediaAsset,
  project: ProjectInfo,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 0. 素材位于项目目录内（最强信号：用户把素材放在了项目文件夹里）
  const assetDir = pathDirname(asset.path);
  if (project.directory && (assetDir === project.directory || assetDir.startsWith(`${project.directory}${path.sep}`) || assetDir.startsWith(`${project.directory}/`))) {
    score += 50;
    reasons.push("素材位于项目目录内");
  }

  // 1. 目录名含项目关键词
  const dirName = pathBasename(assetDir).toLowerCase();
  const dirTokens = new Set(tokenize(dirName));
  let dirHits = 0;
  for (const kw of project.keywords) {
    if (dirTokens.has(kw) || dirName.includes(kw)) dirHits += 1;
  }
  if (dirHits > 0) {
    score += Math.min(40, 20 + dirHits * 10);
    reasons.push(`目录名命中项目关键词(${dirHits})`);
  }

  // 2. 文件名含项目关键词
  const nameTokens = new Set(tokenize(asset.normalizedName));
  let nameHits = 0;
  for (const kw of project.keywords) {
    if (nameTokens.has(kw)) nameHits += 1;
  }
  if (nameHits > 0) {
    score += Math.min(25, 10 + nameHits * 8);
    reasons.push(`文件名命中项目关键词(${nameHits})`);
  }

  // 3. 项目阶段优先（shooting/editing）
  if (project.stage === "shooting" || project.stage === "editing" || project.stage === "ready_to_shoot") {
    score += 20;
    reasons.push(`项目处于${project.stage}阶段`);
  }

  // 4. 素材导入时间与项目最近活动时间接近（7 天内）
  const assetTime = Date.parse(asset.modifiedAt);
  const stageTime = Date.parse(project.stageUpdatedAt);
  if (!isNaN(assetTime) && !isNaN(stageTime)) {
    const diff = Math.abs(assetTime - stageTime);
    if (diff < 24 * 60 * 60 * 1000) {
      score += 18;
      reasons.push("与项目最近活动同日");
    } else if (diff < 7 * 24 * 60 * 60 * 1000) {
      score += 10;
      reasons.push("与项目最近活动一周内");
    }
  }

  return { score, reasons };
}

function pathDirname(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(0, idx) : "";
}
function pathBasename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** 批次分组：同目录 + 1 小时时间窗口 */
function groupBatches(assets: MediaAsset[]): MediaAsset[][] {
  const byDir = new Map<string, MediaAsset[]>();
  for (const a of assets) {
    const dir = pathDirname(a.path);
    const group = byDir.get(dir) || [];
    group.push(a);
    byDir.set(dir, group);
  }
  const batches: MediaAsset[][] = [];
  for (const group of byDir.values()) {
    group.sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
    let currentBatch: MediaAsset[] = [];
    let batchStart = 0;
    for (const a of group) {
      const t = Date.parse(a.modifiedAt);
      if (currentBatch.length === 0) {
        currentBatch.push(a);
        batchStart = t;
      } else if (t - batchStart <= BATCH_WINDOW_MS) {
        currentBatch.push(a);
      } else {
        if (currentBatch.length >= 2) batches.push(currentBatch);
        currentBatch = [a];
        batchStart = t;
      }
    }
    if (currentBatch.length >= 2) batches.push(currentBatch);
  }
  return batches;
}

export interface ProjectMatchResult {
  asset: MediaAsset;
  candidates: ProjectMatchCandidate[];
  autoConfirmed: boolean;
}

export interface MatchProjectsOutput {
  results: ProjectMatchResult[];
  matchedCount: number;
  candidateCount: number;
  unmatchedCount: number;
  persistedAssets: MediaAsset[];
}

/** 对所有未确认项目的素材执行项目匹配（含批次传播） */
export async function matchProjectsForAssets(): Promise<MatchProjectsOutput> {
  const [assets, projects] = await Promise.all([readMediaAssets(), loadProjectInfos()]);
  if (assets.length === 0 || projects.length === 0) {
    return { results: [], matchedCount: 0, candidateCount: 0, unmatchedCount: 0, persistedAssets: assets };
  }

  // 第一轮：基础评分
  const baseResults = new Map<string, ProjectMatchResult>();
  for (const asset of assets) {
    if (asset.projectMatchStatus === "confirmed" && asset.projectSlug) {
      baseResults.set(asset.id, {
        asset,
        candidates: [{
          projectSlug: asset.projectSlug,
          projectName: projects.find((p) => p.slug === asset.projectSlug)?.name || asset.projectSlug,
          score: asset.projectMatchScore || 100,
          reasons: asset.projectMatchReasons || ["已确认"],
        }],
        autoConfirmed: true,
      });
      continue;
    }

    const scored = projects
      .map((p) => ({ project: p, ...scoreProject(asset, p) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const candidates: ProjectMatchCandidate[] = scored.slice(0, MAX_CANDIDATES).map((s) => ({
      projectSlug: s.project.slug,
      projectName: s.project.name,
      score: s.score,
      reasons: s.reasons,
    }));

    const top = candidates[0];
    const autoConfirmed = !!top && top.score >= AUTO_CONFIRM_THRESHOLD;
    baseResults.set(asset.id, { asset, candidates, autoConfirmed });
  }

  // 第二轮：批次传播
  const unconfirmedAssets = assets.filter((a) => !baseResults.get(a.id)?.autoConfirmed);
  const batches = groupBatches(unconfirmedAssets);
  for (const batch of batches) {
    // 找出本批中得分最高的项目
    const projectBestScore = new Map<string, number>();
    for (const a of batch) {
      const r = baseResults.get(a.id);
      if (!r || r.candidates.length === 0) continue;
      const top = r.candidates[0];
      projectBestScore.set(top.projectSlug, Math.max(projectBestScore.get(top.projectSlug) || 0, top.score));
    }
    // 如果本批中有项目得分达到候选阈值，给其他成员加传播分
    for (const [slug, bestScore] of projectBestScore) {
      if (bestScore < CANDIDATE_THRESHOLD) continue;
      const project = projects.find((p) => p.slug === slug);
      if (!project) continue;
      for (const a of batch) {
        const r = baseResults.get(a.id);
        if (!r) continue;
        if (r.autoConfirmed) continue;
        const hasProject = r.candidates.some((c) => c.projectSlug === slug);
        const boost = 30;
        if (hasProject) {
          r.candidates = r.candidates.map((c) =>
            c.projectSlug === slug
              ? { ...c, score: c.score + boost, reasons: [...c.reasons, "批次传播"] }
              : c,
          );
        } else {
          r.candidates.push({
            projectSlug: slug,
            projectName: project.name,
            score: boost,
            reasons: ["批次传播"],
          });
        }
        r.candidates.sort((x, y) => y.score - x.score);
        r.candidates = r.candidates.slice(0, MAX_CANDIDATES);
        // 传播后可能达到自动确认
        if (r.candidates[0]?.score >= AUTO_CONFIRM_THRESHOLD) {
          r.autoConfirmed = true;
        }
      }
    }
  }

  // 回写匹配结果到资产记录
  const toUpdate: MediaAsset[] = [];
  let matchedCount = 0;
  let candidateCount = 0;
  let unmatchedCount = 0;
  const results: ProjectMatchResult[] = [];

  for (const asset of assets) {
    const r = baseResults.get(asset.id);
    if (!r) {
      unmatchedCount += 1;
      results.push({ asset, candidates: [], autoConfirmed: false });
      continue;
    }
    const top = r.candidates[0];
    let projectSlug: string | undefined;
    let projectMatchStatus: MediaAsset["projectMatchStatus"] = "unmatched";
    if (r.autoConfirmed && top) {
      projectSlug = top.projectSlug;
      projectMatchStatus = "confirmed";
      matchedCount += 1;
    } else if (top && top.score >= CANDIDATE_THRESHOLD) {
      projectSlug = top.projectSlug;
      projectMatchStatus = "candidate";
      candidateCount += 1;
    } else {
      unmatchedCount += 1;
    }
    const updated: MediaAsset = {
      ...asset,
      projectSlug,
      projectMatchScore: top?.score,
      projectMatchReasons: top?.reasons,
      projectMatchStatus,
      projectCandidates: r.candidates,
    };
    toUpdate.push(updated);
    results.push({ asset: updated, candidates: r.candidates, autoConfirmed: r.autoConfirmed });
  }

  const persisted = toUpdate.length > 0 ? await updateAssets(toUpdate) : assets;
  return { results, matchedCount, candidateCount, unmatchedCount, persistedAssets: persisted };
}

/** 手动将一批素材归到指定项目 */
export async function assignAssetsToProject(
  assetIds: string[],
  projectSlug: string,
): Promise<MediaAsset[]> {
  const assets = await readMediaAssets();
  const projectName = (await loadProjectSummaries().then((ps) => ps.find((p) => p.slug === projectSlug)?.name)) || projectSlug;
  const toUpdate = assets
    .filter((a) => assetIds.includes(a.id))
    .map((a): MediaAsset => ({
      ...a,
      projectSlug,
      projectMatchScore: 100,
      projectMatchReasons: ["手动归属"],
      projectMatchStatus: "confirmed",
      projectCandidates: [{
        projectSlug,
        projectName,
        score: 100,
        reasons: ["手动归属"],
      }],
    }));
  return toUpdate.length > 0 ? await updateAssets(toUpdate) : assets;
}
