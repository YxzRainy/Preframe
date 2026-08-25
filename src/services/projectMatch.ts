/** 项目自动匹配 — 根据视频文件路径匹配现有内容项目
 * 匹配依据按优先级：文件名相似度 > 文件所在目录名 > 最近活跃 > ready_to_publish 阶段 */

import path from "node:path";

import { readProjects } from "./projectReader.js";
import { readStage } from "./projectStage.js";
import type { ProjectMatchCandidate } from "../types/publishSession.js";

/** 规范化字符串：小写、去标点、去常见后缀、折叠空白 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(final|成片|cut|export|render|v\d+)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 词级 Jaccard 相似度 */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = new Set(na.split(" ").filter(Boolean));
  const sb = new Set(nb.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface MatchInput {
  videoPath: string;
}

export async function matchProject(input: MatchInput): Promise<ProjectMatchCandidate[]> {
  const fileName = path.basename(input.videoPath, path.extname(input.videoPath));
  const dirName = path.basename(path.dirname(input.videoPath));
  const projects = await readProjects().catch(() => []);

  const candidates: ProjectMatchCandidate[] = [];
  for (const project of projects) {
    const reasons: string[] = [];
    let score = 0;

    // 1. 文件名与项目名/相似度
    const nameSim = Math.max(
      similarity(fileName, project.name),
      similarity(fileName, project.slug),
    );
    if (nameSim > 0.3) {
      score += nameSim * 60;
      reasons.push(`文件名与项目名相似度 ${(nameSim * 100).toFixed(0)}%`);
    }

    // 2. 文件所在目录名
    const dirSim = Math.max(
      similarity(dirName, project.name),
      similarity(dirName, project.slug),
    );
    if (dirSim > 0.3) {
      score += dirSim * 25;
      reasons.push(`所在目录与项目名相似`);
    }

    // 3. 最近活跃（按 generatedAt 倒序加分）
    const ageDays = (Date.now() - Date.parse(project.generatedAt)) / 86_400_000;
    if (ageDays >= 0 && ageDays < 30) {
      const recencyScore = Math.max(0, 15 - ageDays * 0.5);
      score += recencyScore;
      if (recencyScore > 5) reasons.push("近期活跃项目");
    }

    // 4. ready_to_publish 阶段加分
    try {
      const stageCtx = await readStage(project.slug);
      if (stageCtx.stage === "ready_to_publish") {
        score += 12;
        reasons.push("项目处于待发布阶段");
      } else if (stageCtx.stage === "editing") {
        score += 5;
        reasons.push("项目处于剪辑中阶段");
      }
    } catch {
      // 阶段读取失败忽略
    }

    if (score > 0) {
      candidates.push({
        projectSlug: project.slug,
        projectName: project.name,
        score: Math.round(score * 10) / 10,
        reasons,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // 分数明显最高时自动选中；否则最多 3 个候选
  return candidates.slice(0, 3);
}

/** 判断是否应自动选中（分数最高且明显高于第二名） */
export function shouldAutoSelect(candidates: ProjectMatchCandidate[]): ProjectMatchCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].score >= 20 ? candidates[0] : null;
  const [first, second] = candidates;
  if (first.score >= 30 && first.score - second.score >= 15) return first;
  return null;
}
