/** 封面自动匹配 — 发现成片后自动寻找最可能对应的封面
 *
 * 查找位置（按优先级）：
 *   1. 视频同目录
 *   2. 项目目录
 *   3. 项目 covers/ assets/ images/ 等现有目录
 * 匹配维度：同文件名前缀 > 项目名 > 最近修改时间 > 常见 cover/封面 命名
 *
 * 不自动生成封面。没找到不阻断发布。
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveProjectDirectory } from "./projectManager.js";
import type { CoverCandidate } from "../types/publishSession.js";

const IMAGE_EXT = /\.(?:jpe?g|png|webp|bmp)$/i;

/** 常见封面命名关键词 */
const COVER_KEYWORDS = ["cover", "封面", "poster", "thumb", "thumbnail", "封图"];

/** 规范化文件名前缀：去后缀、去常见导出词、小写 */
function nameKey(name: string): string {
  return path
    .basename(name, path.extname(name))
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, "")
    .replace(/(final|成片|cut|export|render|v\d+|1080p|720p|4k)/g, "");
}

/** 两个名字前缀的公共前缀长度占比 */
function prefixSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return Math.min(i / Math.max(a.length, b.length), 1);
}

async function scanImages(dir: string): Promise<Array<{ path: string; name: string; mtime: number }>> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: Array<{ path: string; name: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!IMAGE_EXT.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    try {
      const s = await stat(full);
      result.push({ path: full, name: entry.name, mtime: s.mtimeMs });
    } catch {
      // 跳过不可读
    }
  }
  return result;
}

/** 扫描项目子目录（covers/ assets/ images/ img/ thumbnails/） */
async function scanProjectSubdirs(projectDir: string): Promise<Array<{ path: string; name: string; mtime: number }>> {
  const subdirs = ["covers", "assets", "images", "img", "thumbnails", "封面"];
  const all: Array<{ path: string; name: string; mtime: number }> = [];
  for (const sub of subdirs) {
    const images = await scanImages(path.join(projectDir, sub));
    all.push(...images);
  }
  return all;
}

export interface CoverMatchInput {
  videoPath: string;
  projectSlug?: string;
}

export interface CoverMatchResult {
  candidates: CoverCandidate[];
  autoSelect: CoverCandidate | null;
}

/** 高置信度阈值：分数 ≥ 55 自动选中 */
const AUTO_SELECT_THRESHOLD = 55;

export async function findCoverCandidates(input: CoverMatchInput): Promise<CoverMatchResult> {
  const videoPath = input.videoPath;
  const videoDir = path.dirname(videoPath);
  const videoNameKey = nameKey(videoPath);
  const videoMtime = await stat(videoPath).then((s) => s.mtimeMs).catch(() => 0);

  // 收集候选来源目录
  const sources: Array<{ dir: string; images: Array<{ path: string; name: string; mtime: number }> }> = [];

  // 1. 视频同目录
  const sameDirImages = await scanImages(videoDir);
  if (sameDirImages.length > 0) sources.push({ dir: videoDir, images: sameDirImages });

  // 2/3. 项目目录与子目录
  let projectDir: string | null = null;
  if (input.projectSlug) {
    try {
      projectDir = resolveProjectDirectory(input.projectSlug);
    } catch {
      projectDir = null;
    }
  }
  if (projectDir) {
    const projectImages = await scanImages(projectDir);
    if (projectImages.length > 0) sources.push({ dir: projectDir, images: projectImages });
    const subdirImages = await scanProjectSubdirs(projectDir);
    if (subdirImages.length > 0) {
      // 子目录的图已带绝对路径，合并
      sources.push({ dir: "(项目子目录)", images: subdirImages });
    }
  }

  // 评分
  const candidateMap = new Map<string, CoverCandidate & { _mtime: number; _dir: string }>();
  for (const source of sources) {
    for (const img of source.images) {
      const imgNameKey = nameKey(img.name);
      let score = 0;
      const reasons: string[] = [];

      // 1. 同文件名前缀（最强信号）
      const prefix = prefixSimilarity(videoNameKey, imgNameKey);
      if (prefix >= 0.5) {
        score += prefix * 60;
        reasons.push(`与视频文件名前缀匹配 ${(prefix * 100).toFixed(0)}%`);
      }

      // 2. 常见封面命名
      const lowerName = img.name.toLowerCase();
      if (COVER_KEYWORDS.some((kw) => lowerName.includes(kw))) {
        score += 25;
        reasons.push("封面命名约定");
      }

      // 3. 最近修改时间接近视频（同批产出）
      if (videoMtime > 0 && img.mtime > 0) {
        const diffMin = Math.abs(img.mtime - videoMtime) / 60_000;
        if (diffMin < 30) {
          score += Math.max(0, 15 - diffMin * 0.5);
          reasons.push("与视频产出时间接近");
        }
      }

      // 4. 同目录加分（与视频同目录最可信）
      if (source.dir === videoDir) {
        score += 10;
        reasons.push("与视频同目录");
      }

      // 项目子目录弱加分
      if (source.dir === "(项目子目录)") {
        score += 3;
      }

      if (score <= 0) continue;

      const existing = candidateMap.get(img.path);
      if (existing) {
        // 同一文件多来源命中：合并分数与理由（取较高分）
        if (score > existing.score) {
          existing.score = score;
          existing.reasons = [...new Set([...existing.reasons, ...reasons])];
        }
      } else {
        candidateMap.set(img.path, {
          path: img.path,
          score: Math.round(score * 10) / 10,
          reasons,
          _mtime: img.mtime,
          _dir: source.dir,
        });
      }
    }
  }

  const candidates = Array.from(candidateMap.values())
    .sort((a, b) => b.score - a.score || b._mtime - a._mtime)
    .slice(0, 5)
    .map(({ path, score, reasons }) => ({ path, score, reasons }));

  const autoSelect = candidates[0] && candidates[0].score >= AUTO_SELECT_THRESHOLD ? candidates[0] : null;

  return { candidates, autoSelect };
}
