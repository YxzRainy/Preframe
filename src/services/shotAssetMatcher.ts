/** 镜头-素材自动匹配（零模型匹配）
 *
 * 这是本轮核心。每个素材尝试匹配现有 ShotTask，不调用视觉模型。
 *
 * 第一层评分信号：
 * 1. 序列对齐（+35）：文件名序列号与镜头顺序的全局最佳偏移
 * 2. 时长匹配（+20/+10）：asset.duration 与 shotTask.durationSeconds
 * 3. 横竖屏 vs 景别（+15）：竖屏→口播/近景/中景；横屏→全景/录屏
 * 4. 场景/动作关键词（+10）：文件名/描述关键词命中 visualDescription
 * 5. 已确认镜头惩罚（-10）：避免一个素材挤进已确认主素材的镜头
 *
 * 第二层（可选视觉分析）：仅零模型置信度不足时调用，本轮 MVP 不启用，
 * 留接口；无视觉模型能力时整个功能仍正常工作。 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveProjectDirectory } from "./projectManager.js";
import { readProject } from "./projectReader.js";
import { buildShotTasks } from "./shotTaskBuilder.js";
import { readMediaAssets } from "./mediaAssetStore.js";
import { addSuggestedLinks } from "./shotAssetLinkStore.js";
import type { MediaAsset, ShotAssetLink } from "../types/mediaAsset.js";
import type { ShotTask } from "../types/shotTask.js";

const SUGGEST_THRESHOLD = 40; // >= 此分数自动创建 suggested 关系
const CANDIDATE_THRESHOLD = 22; // >= 此分数作为候选展示
const SEQ_BONUS = 35; // 素材属于连续序列（按资产标记）
const SEQ_EXACT_BONUS = 25; // 素材序列号精确对应到该镜头序号
const DURATION_BONUS = 20;
const DURATION_PARTIAL = 10;
const ORIENTATION_BONUS = 15;
const KEYWORD_BONUS = 10;
const CONFIRMED_PENALTY = 10;

// ── 读取项目 ShotTask（缓存优先，缺失时从文档构建） ──

async function readProjectJson(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function loadShotTasks(slug: string): Promise<ShotTask[]> {
  const projectDir = resolveProjectDirectory(slug);
  const metadata = await readProjectJson(projectDir);
  if (Array.isArray(metadata.shotTasks) && metadata.shotTasks.length > 0) {
    return metadata.shotTasks as ShotTask[];
  }
  const project = await readProject(slug);
  return buildShotTasks(project.files);
}

// ── 工具：提取文件名中的序列号 ──

function extractSequenceNumbers(fileName: string): number[] {
  const base = fileName.replace(/\.[^.]+$/, "");
  const matches = base.match(/\d+/g);
  if (!matches) return [];
  // 取所有数字组，过滤过短的（如年份 2026 单独不算序列）
  return matches.map(Number).filter((n) => n >= 1 && n <= 99999);
}

function lastSequenceNumber(fileName: string): number | undefined {
  const nums = extractSequenceNumbers(fileName);
  return nums.length > 0 ? nums[nums.length - 1] : undefined;
}

// ── 景别 → 期望朝向 ──

function expectedOrientation(shot: ShotTask): "portrait" | "landscape" | "any" {
  const text = `${shot.shotType} ${shot.visualDescription}`;
  // 录屏 / 全景 / 画中画 / 信息图 / 动画 → 横屏
  if (/录屏|全景|画中画|信息图|动画|分割画面|全屏/.test(text)) return "landscape";
  // 口播 / 近景 / 中景 / 特写 / 正面 → 竖屏
  if (/口播|近景|中景|特写|正面|侧脸|博主/.test(text)) return "portrait";
  return "any";
}

// ── 关键词匹配 ──

function tokenizeZh(text: string): string[] {
  // 中文按字符 + 英文按词
  return text
    .toLowerCase()
    .replace(/[_\-./\\，。、：；""''（）()\[\]！？]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function keywordMatchScore(asset: MediaAsset, shot: ShotTask): number {
  const assetTokens = new Set(tokenizeZh(asset.normalizedName));
  if (assetTokens.size === 0) return 0;
  const shotText = `${shot.visualDescription} ${shot.narration} ${shot.shotType}`;
  const shotTokens = new Set(tokenizeZh(shotText));
  let hits = 0;
  for (const t of assetTokens) {
    if (shotTokens.has(t)) hits += 1;
    // 子串匹配（中文词可能跨 token）
    else if (shotText.includes(t)) hits += 1;
  }
  return hits > 0 ? Math.min(KEYWORD_BONUS, 5 + hits * 3) : 0;
}

// ── 时长匹配 ──

function durationScore(asset: MediaAsset, shot: ShotTask): number {
  if (shot.durationSeconds && asset.durationSeconds) {
    const ratio = asset.durationSeconds / shot.durationSeconds;
    if (ratio >= 0.4 && ratio <= 2.5) return DURATION_BONUS;
    if (ratio >= 0.2 && ratio <= 5) return DURATION_PARTIAL;
    return 0;
  }
  // 仅一方有时长：给少量分（中性偏正）
  if (shot.durationSeconds || asset.durationSeconds) return 3;
  return 0;
}

// ── 朝向匹配 ──

function orientationScore(asset: MediaAsset, shot: ShotTask): number {
  if (!asset.orientation) return 4; // 无元数据：中性
  const expected = expectedOrientation(shot);
  if (expected === "any") return 5;
  return asset.orientation === expected ? ORIENTATION_BONUS : 0;
}

// ── 序列对齐：找全局最佳偏移 ──

/** 计算全局最佳序列对齐。
 * 返回 assetId → 该素材在最佳对齐中应对应的镜头序号（仅含命中的素材）。
 * 用直方图选最多命中的 offset，把每个素材钉到具体镜头序号，
 * 使连续素材能精确对应到连续镜头，进而触发批量确认建议。 */
function computeBestAlignment(
  assets: MediaAsset[],
  shots: ShotTask[],
): Map<string, number> {
  const aligned = new Map<string, number>(); // assetId → expectedOrder
  if (assets.length === 0 || shots.length === 0) return aligned;

  const assetSeqs: Array<{ asset: MediaAsset; seq: number }> = [];
  for (const a of assets) {
    const seq = lastSequenceNumber(a.fileName);
    if (seq !== undefined) assetSeqs.push({ asset: a, seq });
  }
  if (assetSeqs.length < 2) return aligned; // 少于 2 个有序列号的无法判断对齐

  const shotOrderSet = new Set(shots.map((s) => s.order).filter((o) => o > 0));
  if (shotOrderSet.size === 0) return aligned;

  // 直方图：offset → 命中 asset 数（命中指 seq-offset 落在某个镜头序号上）
  const histogram = new Map<number, Set<string>>();
  for (const { asset, seq } of assetSeqs) {
    for (const order of shotOrderSet) {
      const offset = seq - order;
      const set = histogram.get(offset) || new Set<string>();
      set.add(asset.id);
      histogram.set(offset, set);
    }
  }
  // 选命中数最多的 offset（并列时取 offset 最小者，保证稳定）
  let bestOffset: number | null = null;
  let bestHits = 0;
  for (const [offset, set] of histogram) {
    if (set.size > bestHits || (set.size === bestHits && bestOffset !== null && offset < bestOffset)) {
      bestHits = set.size;
      bestOffset = offset;
    }
  }
  if (bestOffset === null || bestHits < 2) return aligned;

  // 钉定每个对齐素材到具体镜头序号
  for (const { asset, seq } of assetSeqs) {
    const order = seq - bestOffset;
    if (shotOrderSet.has(order)) {
      aligned.set(asset.id, order);
    }
  }
  return aligned;
}

// ── 单个 (asset, shot) 评分 ──

interface ShotScore {
  shotTaskId: string;
  order: number;
  score: number;
  reasons: string[];
  aligned: boolean;
}

function scoreShot(
  asset: MediaAsset,
  shot: ShotTask,
  expectedOrder: number | undefined,
  shotHasConfirmed: boolean,
): ShotScore {
  const reasons: string[] = [];
  let score = 0;

  if (expectedOrder !== undefined) {
    // 素材属于连续序列
    score += SEQ_BONUS;
    reasons.push("序列对齐");
    // 序列号精确对应到该镜头序号 → 额外强信号，把素材钉到具体镜头
    if (expectedOrder === shot.order) {
      score += SEQ_EXACT_BONUS;
      reasons.push("序号精确对应");
    }
  }
  const dur = durationScore(asset, shot);
  if (dur >= DURATION_BONUS) reasons.push("时长匹配");
  else if (dur > 0) reasons.push("时长接近");
  score += dur;

  const ori = orientationScore(asset, shot);
  if (ori >= ORIENTATION_BONUS) reasons.push("横竖屏匹配");
  else if (ori > 0) reasons.push("朝向中性");
  score += ori;

  const kw = keywordMatchScore(asset, shot);
  if (kw > 0) reasons.push("关键词命中");
  score += kw;

  if (shotHasConfirmed) {
    score -= CONFIRMED_PENALTY;
    reasons.push("镜头已有素材(-)");
  }

  return { shotTaskId: shot.id, order: shot.order, score, reasons, aligned: expectedOrder !== undefined };
}

// ── 批次建议检测 ──

export interface BatchSuggestion {
  /** 起始镜头序号 */
  startOrder: number;
  /** 结束镜头序号 */
  endOrder: number;
  /** 涉及的 linkId 列表 */
  linkIds: string[];
  count: number;
}

function detectBatchSuggestions(
  suggestedLinks: ShotAssetLink[],
  shots: ShotTask[],
): BatchSuggestion[] {
  if (suggestedLinks.length < 3) return [];
  const shotById = new Map(shots.map((s) => [s.id, s]));
  // 按 asset 序列号排序，取对应的 shot order
  const orderedLinks = suggestedLinks
    .map((l) => {
      const shot = shotById.get(l.shotTaskId);
      return shot ? { link: l, order: shot.order } : null;
    })
    .filter((x): x is { link: ShotAssetLink; order: number } => x !== null)
    .sort((a, b) => a.order - b.order);

  const suggestions: BatchSuggestion[] = [];
  let runStart = 0;
  for (let i = 1; i <= orderedLinks.length; i++) {
    const prev = orderedLinks[i - 1];
    const curr = i < orderedLinks.length ? orderedLinks[i] : null;
    const consecutive = curr && curr.order === prev.order + 1;
    if (!consecutive) {
      const runLen = i - runStart;
      if (runLen >= 3) {
        const start = orderedLinks[runStart].order;
        const end = orderedLinks[i - 1].order;
        suggestions.push({
          startOrder: start,
          endOrder: end,
          linkIds: orderedLinks.slice(runStart, i).map((x) => x.link.id),
          count: runLen,
        });
      }
      runStart = i;
    }
  }
  return suggestions;
}

// ── 主入口 ──

export interface ShotMatchCandidate {
  shotTaskId: string;
  order: number;
  score: number;
  reasons: string[];
}

export interface ShotMatchResult {
  assetId: string;
  bestShot?: ShotMatchCandidate;
  candidates: ShotMatchCandidate[];
}

export interface MatchShotsOutput {
  projectSlug: string;
  results: ShotMatchResult[];
  suggestedLinks: ShotAssetLink[];
  batchSuggestions: BatchSuggestion[];
  shotTaskCount: number;
  assetCount: number;
}

/** 对指定项目的素材执行镜头匹配，创建 suggested 关系 */
export async function matchShotsForProject(projectSlug: string): Promise<MatchShotsOutput> {
  const [shotTasks, allAssets, existingLinks] = await Promise.all([
    loadShotTasks(projectSlug),
    readMediaAssets(),
    import("./shotAssetLinkStore.js").then((m) => m.getLinksForProject(projectSlug)),
  ]);

  const projectAssets = allAssets.filter(
    (a) => a.projectSlug === projectSlug || a.projectMatchStatus === "unmatched",
  );

  if (shotTasks.length === 0 || projectAssets.length === 0) {
    return {
      projectSlug,
      results: [],
      suggestedLinks: [],
      batchSuggestions: [],
      shotTaskCount: shotTasks.length,
      assetCount: projectAssets.length,
    };
  }

  // 已确认主素材的镜头集合（用于惩罚）
  const confirmedShots = new Set(
    existingLinks.filter((l) => l.status === "confirmed").map((l) => l.shotTaskId),
  );

  // 序列对齐
  const alignment = computeBestAlignment(projectAssets, shotTasks);

  // 评分
  const results: ShotMatchResult[] = [];
  const suggestedInputs: Array<{
    projectSlug: string;
    shotTaskId: string;
    assetId: string;
    confidence: number;
    source: "automatic";
  }> = [];

  for (const asset of projectAssets) {
    const expectedOrder = alignment.get(asset.id);
    const scored = shotTasks.map((shot) =>
      scoreShot(asset, shot, expectedOrder, confirmedShots.has(shot.id)),
    );
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const candidates: ShotMatchCandidate[] = scored
      .filter((s) => s.score >= CANDIDATE_THRESHOLD)
      .slice(0, 3)
      .map((s) => ({
        shotTaskId: s.shotTaskId,
        order: s.order,
        score: s.score,
        reasons: s.reasons,
      }));

    const result: ShotMatchResult = {
      assetId: asset.id,
      bestShot: candidates[0],
      candidates,
    };
    results.push(result);

    // 高分自动创建 suggested 关系
    if (best && best.score >= SUGGEST_THRESHOLD) {
      // 避免与已存在的 confirmed 关系重复
      const alreadyConfirmed = existingLinks.some(
        (l) =>
          l.assetId === asset.id &&
          l.shotTaskId === best.shotTaskId &&
          l.status === "confirmed",
      );
      if (!alreadyConfirmed) {
        suggestedInputs.push({
          projectSlug,
          shotTaskId: best.shotTaskId,
          assetId: asset.id,
          confidence: Math.min(99, best.score),
          source: "automatic",
        });
      }
    }
  }

  // 写入 suggested 关系
  let updatedLinks = existingLinks;
  if (suggestedInputs.length > 0) {
    const allLinks = await addSuggestedLinks(suggestedInputs);
    updatedLinks = allLinks.filter((l) => l.projectSlug === projectSlug);
  }

  const suggestedLinks = updatedLinks.filter((l) => l.status === "suggested");
  const batchSuggestions = detectBatchSuggestions(suggestedLinks, shotTasks);

  return {
    projectSlug,
    results,
    suggestedLinks,
    batchSuggestions,
    shotTaskCount: shotTasks.length,
    assetCount: projectAssets.length,
  };
}

// ── 缺镜头检测 ──

export interface MissingShotInfo {
  shotTaskId: string;
  order: number;
  shotType: string;
  narration: string;
  hasCandidate: boolean;
}

export async function detectMissingShots(
  _projectSlug: string,
  shotTasks: ShotTask[],
  links: ShotAssetLink[],
): Promise<{ missing: MissingShotInfo[]; total: number; withAsset: number; missingCount: number }> {
  const confirmedByShot = new Set(
    links.filter((l) => l.status === "confirmed").map((l) => l.shotTaskId),
  );
  const candidateByShot = new Set(
    links.filter((l) => l.status === "suggested").map((l) => l.shotTaskId),
  );

  const missing: MissingShotInfo[] = [];
  for (const shot of shotTasks) {
    if (confirmedByShot.has(shot.id)) continue;
    missing.push({
      shotTaskId: shot.id,
      order: shot.order,
      shotType: shot.shotType,
      narration: (shot.narration || "").slice(0, 60),
      hasCandidate: candidateByShot.has(shot.id),
    });
  }
  missing.sort((a, b) => a.order - b.order);
  const withAsset = shotTasks.length - missing.length;
  return {
    missing,
    total: shotTasks.length,
    withAsset,
    missingCount: missing.length,
  };
}
