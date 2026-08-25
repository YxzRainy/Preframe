/**
 * shotTaskBuilder — 从现有 03/04/05/07/09 文档解析出结构化镜头任务。
 *
 * 设计原则：
 * - 不依赖新的模型请求，纯文本解析
 * - 解析失败时返回空数组，不影响原有 10 文档流程
 * - 以 04_分镜与剪辑节奏 为主干，其他文档补充信息
 */

import type { ShotTask, ShotTaskStatus } from "../types/shotTask.js";
import type { ContentFile } from "../services/contentWorkflow.js";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function findFile(files: ContentFile[], prefix: string): string | undefined {
  return files.find((f) => f.name.startsWith(prefix))?.content;
}

function parseDuration(text: string): number | undefined {
  // "0-5s" → 5, "5-10s" → 5, "00:05-00:12" → 7, "5s" → 5
  const rangeSeconds = text.match(/(\d+)-(\d+)\s*s/i);
  if (rangeSeconds) return Number(rangeSeconds[2]) - Number(rangeSeconds[1]);
  const timecodeRange = text.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (timecodeRange) {
    const start = Number(timecodeRange[1]) * 60 + Number(timecodeRange[2]);
    const end = Number(timecodeRange[3]) * 60 + Number(timecodeRange[4]);
    return end - start;
  }
  const plain = text.match(/(\d+)\s*s/i);
  if (plain) return Number(plain[1]);
  return undefined;
}

function makeId(order: number): string {
  return `shot-${String(order).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// 04 分镜表解析（Markdown 表格）
// ---------------------------------------------------------------------------

interface StoryboardRow {
  order: number;
  visual: string;
  duration: string;
  subtitles: string;
  rhythm: string;
  required: boolean;
  alternative: string;
  notes: string;
}

function parseStoryboardTable(md: string): StoryboardRow[] {
  const lines = md.split("\n");
  const rows: StoryboardRow[] = [];
  let headerFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    // 跳过分隔行 |---|---|
    if (/^\|[\s-|:]+\|$/.test(trimmed)) {
      headerFound = true;
      continue;
    }
    if (!headerFound) continue;

    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;

    const orderMatch = cells[0]?.match(/\d+/);
    if (!orderMatch) continue;

    rows.push({
      order: Number(orderMatch[0]),
      visual: cells[1] || "",
      duration: cells[2] || "",
      subtitles: cells[3] || "",
      rhythm: cells[4] || "",
      required: /必拍/.test(cells[5] || ""),
      alternative: cells[6] || "",
      notes: cells[7] || "",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 05 拍摄清单：提取「必拍镜头」列表
// ---------------------------------------------------------------------------

function parseRequiredShots(md: string): Set<number> {
  const ids = new Set<number>();
  const section = md.match(/##\s*必拍镜头([\s\S]*?)(?=\n##|\n$|$)/);
  if (!section) return ids;
  const matches = section[1].matchAll(/镜头\s*(\d+)/g);
  for (const m of matches) ids.add(Number(m[1]));
  return ids;
}

function parseShootingAssets(md: string): { equipment: string[]; risks: string[] } {
  const equipment: string[] = [];
  const risks: string[] = [];
  const eqSection = md.match(/##\s*场景设备([\s\S]*?)(?=\n##|\n$|$)/);
  if (eqSection) {
    for (const line of eqSection[1].split("\n")) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (trimmed) equipment.push(trimmed);
    }
  }
  const riskSection = md.match(/##\s*拍摄风险([\s\S]*?)(?=\n##|\n$|$)/);
  if (riskSection) {
    for (const line of riskSection[1].split("\n")) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (trimmed) risks.push(trimmed);
    }
  }
  return { equipment, risks };
}

// ---------------------------------------------------------------------------
// 07 视觉参考提示词：提取 AI 生成提示词
// ---------------------------------------------------------------------------

function parseVisualPrompts(md: string): string[] {
  const prompts: string[] = [];
  // 提取引号内的提示词
  const matches = md.matchAll(/["""]([^"""]{20,})["""]/g);
  for (const m of matches) prompts.push(m[1]);
  return prompts;
}

// ---------------------------------------------------------------------------
// 09 成片执行稿：提取逐镜头时间安排
// ---------------------------------------------------------------------------

interface ExecutionRow {
  timeRange: string;
  visual: string;
  narration: string;
  bRoll: string;
  notes: string;
}

function parseExecutionTable(md: string): ExecutionRow[] {
  const lines = md.split("\n");
  const rows: ExecutionRow[] = [];
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
    if (cells.length < 3) continue;
    // 第一列应该含时间码
    if (!/\d{2}:\d{2}/.test(cells[0])) continue;

    rows.push({
      timeRange: cells[0] || "",
      visual: cells[1] || "",
      narration: cells[2] || "",
      bRoll: cells[3] || "",
      notes: cells[4] || "",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 03 口播脚本：提取正文分段作为 narration
// ---------------------------------------------------------------------------

function parseNarrationSegments(md: string): string[] {
  const section = md.match(/##\s*正文脚本([\s\S]*?)(?=\n##|$)/);
  if (!section) return [];
  // 以引号段落或空行分段
  const segments: string[] = [];
  const paragraphs = section[1].split(/\n{2,}/);
  for (const p of paragraphs) {
    const cleaned = p.replace(/^[（(].+?[)）]\s*/gm, "").replace(/[""]/g, "").trim();
    if (cleaned.length > 10) segments.push(cleaned);
  }
  return segments;
}

// ---------------------------------------------------------------------------
// 主构建函数
// ---------------------------------------------------------------------------

/**
 * 从项目的已有文档构建镜头任务列表。
 * 优先以 04_分镜与剪辑节奏 表格为主干，补充 05 拍摄清单、07 视觉提示词、
 * 09 成片执行稿和 03 口播脚本的信息。
 *
 * 解析失败时返回空数组，不抛异常。
 */
export function buildShotTasks(files: ContentFile[]): ShotTask[] {
  try {
    return buildShotTasksUnsafe(files);
  } catch {
    return [];
  }
}

/**
 * 文档变化后重建镜头任务时保留现场状态。
 * 优先按镜头内容身份匹配，序号仅作为兜底；新增镜头使用 builder 的默认状态。
 */
export function mergeShotTaskState(previous: ShotTask[], rebuilt: ShotTask[]): ShotTask[] {
  return mergeShotTaskStateWithMap(previous, rebuilt).tasks;
}

export interface ShotTaskStateMergeResult {
  tasks: ShotTask[];
  /** 旧任务 id 到新任务 id，用于同步迁移素材关系。 */
  idMap: Map<string, string>;
}

function normalizedIdentityText(value: string | undefined): string {
  return (value || "")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 240);
}

function shotIdentity(task: ShotTask): string {
  return [
    normalizedIdentityText(task.visualDescription),
    normalizedIdentityText(task.narration),
    normalizedIdentityText(task.shotType),
    [...(task.requiredAssets || [])].map(normalizedIdentityText).sort().join("|"),
  ].join("::");
}

function carryExecutionState(task: ShotTask, old: ShotTask): ShotTask {
  return {
    ...task,
    status: old.status,
    existingAssets: Array.isArray(old.existingAssets) ? [...old.existingAssets] : [],
    missingAssets: Array.isArray(old.missingAssets) ? [...old.missingAssets] : [...task.missingAssets],
    notes: old.notes,
  };
}

function isCompatibleRevision(old: ShotTask, rebuilt: ShotTask): boolean {
  const oldVisual = normalizedIdentityText(old.visualDescription);
  const nextVisual = normalizedIdentityText(rebuilt.visualDescription);
  const oldNarration = normalizedIdentityText(old.narration);
  const nextNarration = normalizedIdentityText(rebuilt.narration);
  const overlaps = (left: string, right: string) => left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left));
  return overlaps(oldVisual, nextVisual) || overlaps(oldNarration, nextNarration);
}

/**
 * 先按镜头内容身份迁移，再按相同 id 兜底。这样在分镜前部插入镜头时，
 * 已拍摄状态不会因为序号整体后移而挂到错误的新镜头上。
 */
export function mergeShotTaskStateWithMap(previous: ShotTask[], rebuilt: ShotTask[]): ShotTaskStateMergeResult {
  const previousById = new Map(previous.map((task) => [task.id, task]));
  const previousByIdentity = new Map<string, ShotTask[]>();
  for (const task of previous) {
    const identity = shotIdentity(task);
    if (!identity.replaceAll(":", "")) continue;
    const matches = previousByIdentity.get(identity) || [];
    matches.push(task);
    previousByIdentity.set(identity, matches);
  }

  const usedPreviousIds = new Set<string>();
  const matched = new Map<string, ShotTask>();
  const idMap = new Map<string, string>();

  // 同一 id 的增补式修改优先视为原镜头修订，避免被后方的相似新镜头抢占状态。
  for (const task of rebuilt) {
    const old = previousById.get(task.id);
    if (!old || !isCompatibleRevision(old, task)) continue;
    matched.set(task.id, old);
    usedPreviousIds.add(old.id);
    idMap.set(old.id, task.id);
  }

  for (const task of rebuilt) {
    if (matched.has(task.id)) continue;
    const candidates = previousByIdentity.get(shotIdentity(task)) || [];
    const old = candidates.find((candidate) => !usedPreviousIds.has(candidate.id));
    if (!old) continue;
    matched.set(task.id, old);
    usedPreviousIds.add(old.id);
    idMap.set(old.id, task.id);
  }

  for (const task of rebuilt) {
    if (matched.has(task.id)) continue;
    const old = previousById.get(task.id);
    if (!old || usedPreviousIds.has(old.id)) continue;
    matched.set(task.id, old);
    usedPreviousIds.add(old.id);
    idMap.set(old.id, task.id);
  }

  return {
    tasks: rebuilt.map((task) => {
      const old = matched.get(task.id);
      return old ? carryExecutionState(task, old) : task;
    }),
    idMap,
  };
}

function buildShotTasksUnsafe(files: ContentFile[]): ShotTask[] {
  const doc04 = findFile(files, "04_");
  if (!doc04) return [];

  const storyboardRows = parseStoryboardTable(doc04);
  if (!storyboardRows.length) return [];

  const doc05 = findFile(files, "05_");
  const doc07 = findFile(files, "07_");
  const doc09 = findFile(files, "09_");
  const doc03 = findFile(files, "03_");

  const requiredFromChecklist = doc05 ? parseRequiredShots(doc05) : new Set<number>();
  const shootingInfo = doc05 ? parseShootingAssets(doc05) : { equipment: [], risks: [] };
  const visualPrompts = doc07 ? parseVisualPrompts(doc07) : [];
  const executionRows = doc09 ? parseExecutionTable(doc09) : [];
  const narrationSegments = doc03 ? parseNarrationSegments(doc03) : [];

  const tasks: ShotTask[] = [];

  for (let i = 0; i < storyboardRows.length; i++) {
    const row = storyboardRows[i];
    const executionRow = executionRows[i];

    // 口播内容：优先从 09 成片执行稿，其次 04 字幕列，最后 03 口播脚本
    const narration = executionRow?.narration
      || row.subtitles
      || narrationSegments[i]
      || "";

    // 镜头类型：从画面描述中推断
    const shotType = inferShotType(row.visual);

    // 时长：优先 09 时间码，其次 04 时长列
    const durationText = executionRow?.timeRange || row.duration;
    const durationSeconds = parseDuration(durationText);

    // 画面描述：合并 04 画面 + 09 画面
    const visualDescription = executionRow
      ? `${row.visual}\n${executionRow.visual}`.trim()
      : row.visual;

    // 所需素材：从 04 画面描述和 09 B-roll 中提取
    const requiredAssets = extractAssets(row.visual, executionRow?.bRoll || "", row.alternative);

    // AI 提示词：按顺序分配已解析的视觉提示词
    const aiPrompt = visualPrompts[i] || undefined;

    // 状态：默认 todo
    const status: ShotTaskStatus = "todo";

    tasks.push({
      id: makeId(row.order),
      order: row.order,
      narration: cleanText(narration),
      shotType,
      durationSeconds,
      visualDescription: cleanText(visualDescription),
      requiredAssets,
      existingAssets: [],
      missingAssets: [...requiredAssets],
      aiPrompt,
      status,
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function inferShotType(visual: string): string {
  if (/特写/.test(visual)) return "特写";
  if (/近景/.test(visual)) return "近景";
  if (/半侧|侧脸/.test(visual)) return "侧面近景";
  if (/中景/.test(visual)) return "中景";
  if (/全景/.test(visual)) return "全景";
  if (/文字动画|信息图|动画/.test(visual)) return "图文动画";
  if (/引导互动|图标/.test(visual)) return "互动引导";
  return "标准镜头";
}

function extractAssets(visual: string, bRoll: string, alternative: string): string[] {
  const assets: string[] = [];
  const combined = `${visual} ${bRoll} ${alternative}`;

  // 从常见关键词中提取素材需求
  const patterns: Array<[RegExp, string]> = [
    [/游戏显卡|主机|显卡/g, "游戏显卡/主机素材"],
    [/手机/g, "手机画面素材"],
    [/书架|书籍/g, "书架/书籍背景"],
    [/论文/g, "论文截图素材"],
    [/动画|信息图|拼图/g, "后期动画/信息图"],
    [/音效/g, "音效素材"],
    [/封面/g, "封面图片"],
    [/字幕/g, "字幕模板"],
    [/补光|灯/g, "补光设备"],
    [/领夹麦/g, "领夹麦克风"],
  ];

  const seen = new Set<string>();
  for (const [pattern, label] of patterns) {
    if (pattern.test(combined) && !seen.has(label)) {
      seen.add(label);
      assets.push(label);
    }
  }

  return assets;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^["""]|["""]$/g, "")
    .trim();
}
