/** 剪辑准备清单生成 — 项目目录/editing/EDIT_PLAN.json + 剪辑准备.md
 *
 * 不复制素材。默认只引用原素材绝对路径。
 * 内容：镜头顺序、对应素材路径、推荐主素材、备用素材、缺失镜头、口播/画面说明、剪辑节奏备注。 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveProjectDirectory } from "./projectManager.js";
import { readProject } from "./projectReader.js";
import { buildShotTasks } from "./shotTaskBuilder.js";
import { readMediaAssets } from "./mediaAssetStore.js";
import { getLinksForProject } from "./shotAssetLinkStore.js";
import type { ShotAssetLink } from "../types/mediaAsset.js";
import type { ShotTask } from "../types/shotTask.js";

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

/** 从 04 文档提取剪辑节奏备注（按镜头序号） */
function extractRhythmNotes(doc04Content: string): Map<number, string> {
  const notes = new Map<number, string>();
  const lines = doc04Content.split("\n");
  let headerFound = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|[\s-|:]+\|$/.test(trimmed)) {
      headerFound = true;
      continue;
    }
    if (!headerFound) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 5) continue;
    const orderMatch = cells[0]?.match(/\d+/);
    if (!orderMatch) continue;
    notes.set(Number(orderMatch[0]), cells[4] || ""); // 第5列为剪辑节奏
  }
  return notes;
}

export interface EditPlanShot {
  order: number;
  shotTaskId: string;
  shotType: string;
  narration: string;
  visualDescription: string;
  durationSeconds?: number;
  primaryAssetPath?: string;
  primaryAssetName?: string;
  backupAssets: Array<{ path: string; name: string; confidence: number }>;
  missing: boolean;
  hasCandidate: boolean;
  rhythmNote?: string;
}

export interface EditPlan {
  projectSlug: string;
  projectName: string;
  generatedAt: string;
  totalShots: number;
  shotsWithAsset: number;
  missingShots: number;
  shots: EditPlanShot[];
}

export interface EditPlanResult {
  jsonPath: string;
  markdownPath: string;
  plan: EditPlan;
}

export async function buildEditPlan(slug: string): Promise<EditPlanResult> {
  const projectDir = resolveProjectDirectory(slug);
  const [shotTasks, allAssets, links, project] = await Promise.all([
    loadShotTasks(slug),
    readMediaAssets(),
    getLinksForProject(slug),
    readProject(slug),
  ]);

  // 提取剪辑节奏备注
  const doc04 = project.files.find((f) => f.name.startsWith("04_"));
  const rhythmNotes = doc04 ? extractRhythmNotes(doc04.content) : new Map<number, string>();

  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  const linksByShot = new Map<string, ShotAssetLink[]>();
  for (const l of links) {
    if (l.status === "rejected") continue;
    const arr = linksByShot.get(l.shotTaskId) || [];
    arr.push(l);
    linksByShot.set(l.shotTaskId, arr);
  }

  const projectName = project.metadata.projectName || slug;
  const shots: EditPlanShot[] = shotTasks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((shot): EditPlanShot => {
      const shotLinks = (linksByShot.get(shot.id) || []).sort((a, b) => {
        // primary 优先，然后 confidence
        if (a.primary && !b.primary) return -1;
        if (!a.primary && b.primary) return 1;
        return b.confidence - a.confidence;
      });
      const confirmed = shotLinks.filter((l) => l.status === "confirmed");
      const suggested = shotLinks.filter((l) => l.status === "suggested");
      const ordered = [...confirmed, ...suggested];

      const primary = ordered[0] ? assetById.get(ordered[0].assetId) : undefined;
      const backups = ordered
        .slice(1)
        .map((l) => {
          const a = assetById.get(l.assetId);
          return a ? { path: a.path, name: a.fileName, confidence: l.confidence } : null;
        })
        .filter((x): x is { path: string; name: string; confidence: number } => x !== null);

      return {
        order: shot.order,
        shotTaskId: shot.id,
        shotType: shot.shotType,
        narration: shot.narration || "",
        visualDescription: shot.visualDescription || "",
        durationSeconds: shot.durationSeconds,
        primaryAssetPath: primary?.path,
        primaryAssetName: primary?.fileName,
        backupAssets: backups,
        missing: confirmed.length === 0,
        hasCandidate: suggested.length > 0 && confirmed.length === 0,
        rhythmNote: rhythmNotes.get(shot.order),
      };
    });

  const shotsWithAsset = shots.filter((s) => !s.missing).length;
  const missingShots = shots.length - shotsWithAsset;

  const plan: EditPlan = {
    projectSlug: slug,
    projectName,
    generatedAt: new Date().toISOString(),
    totalShots: shots.length,
    shotsWithAsset,
    missingShots,
    shots,
  };

  // 写入 editing/ 子目录
  const editingDir = path.join(projectDir, "editing");
  await mkdir(editingDir, { recursive: true });
  const jsonPath = path.join(editingDir, "EDIT_PLAN.json");
  const markdownPath = path.join(editingDir, "剪辑准备.md");

  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(plan), "utf8");

  return { jsonPath, markdownPath, plan };
}

function renderMarkdown(plan: EditPlan): string {
  const lines: string[] = [];
  lines.push(`# 剪辑准备清单 — ${plan.projectName}`);
  lines.push("");
  lines.push(`> 生成时间：${plan.generatedAt}`);
  lines.push(`> 镜头总数：${plan.totalShots} · 已有素材：${plan.shotsWithAsset} · 缺失：${plan.missingShots}`);
  lines.push("");
  lines.push("> 本清单仅引用原素材绝对路径，不复制任何视频文件。");
  lines.push("");

  for (const shot of plan.shots) {
    const status = shot.missing ? (shot.hasCandidate ? "🟡 有候选" : "🔴 缺失") : "🟢 已有素材";
    lines.push(`## 镜头 ${String(shot.order).padStart(2, "0")} · ${shot.shotType} · ${status}`);
    lines.push("");
    if (shot.durationSeconds) lines.push(`- 预估时长：${shot.durationSeconds}s`);
    if (shot.narration) {
      lines.push(`- 口播：${shot.narration}`);
    }
    if (shot.visualDescription) {
      lines.push(`- 画面：${shot.visualDescription}`);
    }
    if (shot.rhythmNote) {
      lines.push(`- 剪辑节奏：${shot.rhythmNote}`);
    }
    if (shot.primaryAssetPath) {
      lines.push(`- **主素材**：\`${shot.primaryAssetPath}\``);
      if (shot.primaryAssetName) lines.push(`  - 文件名：${shot.primaryAssetName}`);
    } else {
      lines.push(`- **主素材**：（无）`);
    }
    if (shot.backupAssets.length > 0) {
      lines.push(`- 备用素材：`);
      for (const b of shot.backupAssets) {
        lines.push(`  - \`${b.path}\`（置信度 ${b.confidence}）`);
      }
    }
    lines.push("");
  }

  // 缺失镜头汇总
  const missing = plan.shots.filter((s) => s.missing);
  if (missing.length > 0) {
    lines.push(`## 缺失镜头汇总（${missing.length}）`);
    lines.push("");
    for (const s of missing) {
      lines.push(`- 镜头 ${String(s.order).padStart(2, "0")} · ${s.shotType}${s.hasCandidate ? "（有候选素材待确认）" : ""}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("*由 Preframe 自动生成。素材路径为绝对路径，请在剪辑软件中直接引用。*");
  return lines.join("\n");
}
