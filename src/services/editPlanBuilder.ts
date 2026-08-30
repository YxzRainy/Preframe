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
  csvPath: string;
  srtPath: string;
  missingReportPath: string;
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
  const csvPath = path.join(editingDir, "剪辑时间线.csv");
  const srtPath = path.join(editingDir, "口播字幕.srt");
  const missingReportPath = path.join(editingDir, "缺失镜头报告.md");

  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(plan), "utf8");
  await writeFile(csvPath, renderCsv(plan), "utf8");
  await writeFile(srtPath, renderSrt(plan), "utf8");
  await writeFile(missingReportPath, renderMissingReport(plan), "utf8");

  return { jsonPath, markdownPath, csvPath, srtPath, missingReportPath, plan };
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\n]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(plan: EditPlan): string {
  const header = ["镜头", "景别", "时长秒", "口播", "画面说明", "主素材路径", "主素材文件", "状态", "剪辑节奏"];
  const rows = plan.shots.map((shot) => [
    String(shot.order), shot.shotType, shot.durationSeconds, shot.narration, shot.visualDescription,
    shot.primaryAssetPath, shot.primaryAssetName, shot.missing ? (shot.hasCandidate ? "待确认" : "缺失") : "已就绪", shot.rhythmNote,
  ].map(csvCell).join(","));
  return `\ufeff${header.map(csvCell).join(",")}\n${rows.join("\n")}\n`;
}

function srtTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hour = Math.floor(ms / 3_600_000);
  const minute = Math.floor((ms % 3_600_000) / 60_000);
  const second = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function renderSrt(plan: EditPlan): string {
  let cursor = 0;
  const blocks: string[] = [];
  for (const shot of plan.shots) {
    const duration = Math.max(1, shot.durationSeconds || 3);
    const narration = shot.narration.replace(/\s+/g, " ").trim();
    if (narration) blocks.push(`${blocks.length + 1}\n${srtTimestamp(cursor)} --> ${srtTimestamp(cursor + duration)}\n${narration}`);
    cursor += duration;
  }
  return `${blocks.join("\n\n")}\n`;
}

function renderMissingReport(plan: EditPlan): string {
  const missing = plan.shots.filter((shot) => shot.missing);
  const lines = [`# 缺失镜头报告 — ${plan.projectName}`, "", `生成于：${plan.generatedAt}`, ""];
  if (!missing.length) return `${lines.concat(["所有镜头均已有确认素材。", ""]).join("\n")}`;
  lines.push(`共 ${missing.length} 个镜头尚不能直接进入剪辑：`, "");
  for (const shot of missing) lines.push(`- 镜头 ${String(shot.order).padStart(2, "0")} · ${shot.shotType || "镜头"} · ${shot.hasCandidate ? "有候选素材待确认" : "无匹配素材"}${shot.visualDescription ? `\n  - 画面：${shot.visualDescription}` : ""}`);
  return `${lines.join("\n")}\n`;
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
