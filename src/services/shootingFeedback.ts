import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createId, nowIso } from "./localStore.js";
import { resolveProjectDirectory } from "./projectManager.js";
import { writeJson, writeMarkdown } from "./fileWriter.js";
import type { ContentFile } from "./contentWorkflow.js";
import type { ShotTask } from "../types/shotTask.js";
import type {
  AddedShotRecord,
  FeedbackRevision,
  RevisionFileSummary,
  ShotActualRecord,
  ShotActualOutcome,
  ShootingFeedback,
  ShootingFeedbackInput,
} from "../types/shootingFeedback.js";

const FEEDBACK_FILE = "shooting-feedback.json";
const REVISIONS_DIR = "revisions";
const REVISION_INDEX = "feedback-revisions.json";

interface FeedbackStore {
  feedback: ShootingFeedback[];
  updatedAt: string;
}

function emptyStore(): FeedbackStore {
  return { feedback: [], updatedAt: nowIso() };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function readStore(projectDir: string): Promise<FeedbackStore> {
  const store = await readJson<FeedbackStore>(path.join(projectDir, FEEDBACK_FILE), emptyStore());
  return Array.isArray(store.feedback) ? store : emptyStore();
}

async function updateProjectStrategy(projectDir: string, feedback: ShootingFeedback, allFeedback: ShootingFeedback[]): Promise<void> {
  const projectJsonPath = path.join(projectDir, "project.json");
  const metadata = await readJson<Record<string, unknown>>(projectJsonPath, {});
  const recurringIssues = Array.from(new Set(allFeedback.flatMap((item) => [
    ...item.onSetIssues,
    ...item.shotRecords.map((record) => record.issue).filter((value): value is string => Boolean(value)),
  ]))).slice(0, 30);
  metadata.shootingStrategy = {
    updatedAt: nowIso(),
    sourceFeedbackId: feedback.id,
    recurringIssues,
    scriptAdjustments: feedback.scriptAdjustments || "",
    storyboardAdjustments: feedback.storyboardAdjustments || "",
    checklistAdjustments: feedback.checklistAdjustments || "",
    overallNote: feedback.overallNote || "",
  };
  await writeJson(projectJsonPath, metadata);
}

function cleanLines(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return undefined;
}

function normalizeShotRecords(value: unknown): ShotActualRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      shotTaskId: typeof item.shotTaskId === "string" ? item.shotTaskId : "",
      order: Math.max(0, Math.round(finiteNumber(item.order) || 0)),
      label: optionalText(item.label),
      plannedDurationSeconds: finiteNumber(item.plannedDurationSeconds),
      actualDurationSeconds: finiteNumber(item.actualDurationSeconds),
      outcome: (item.outcome === "removed" || item.outcome === "reshoot" || item.outcome === "not_shot" ? item.outcome : "used") as ShotActualOutcome,
      issue: optionalText(item.issue),
      note: optionalText(item.note),
    }))
    .filter((item) => item.shotTaskId || item.order > 0);
}

function normalizeAddedShots(value: unknown): AddedShotRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : createId("added-shot"),
      label: typeof item.label === "string" ? item.label.trim() : "",
      actualDurationSeconds: finiteNumber(item.actualDurationSeconds),
      reason: optionalText(item.reason),
    }))
    .filter((item) => item.label);
}

function normalizeInput(input: ShootingFeedbackInput, existing?: ShootingFeedback): ShootingFeedback {
  const now = nowIso();
  return {
    id: existing?.id || input.id || createId("feedback"),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    title: optionalText(input.title) || existing?.title || `拍摄复盘 ${now.slice(0, 10)}`,
    shootDate: optionalText(input.shootDate),
    location: optionalText(input.location),
    shotRecords: normalizeShotRecords(input.shotRecords),
    addedShots: normalizeAddedShots(input.addedShots),
    onSetIssues: cleanLines(input.onSetIssues),
    overallNote: optionalText(input.overallNote),
    scriptAdjustments: optionalText(input.scriptAdjustments),
    storyboardAdjustments: optionalText(input.storyboardAdjustments),
    checklistAdjustments: optionalText(input.checklistAdjustments),
  };
}

export async function listShootingFeedback(slug: string): Promise<ShootingFeedback[]> {
  const store = await readStore(resolveProjectDirectory(slug));
  return [...store.feedback].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function saveShootingFeedback(slug: string, input: ShootingFeedbackInput): Promise<ShootingFeedback> {
  const projectDir = resolveProjectDirectory(slug);
  const store = await readStore(projectDir);
  const existing = input.id ? store.feedback.find((item) => item.id === input.id) : undefined;
  const feedback = normalizeInput(input, existing);
  if (existing) {
    store.feedback = store.feedback.map((item) => item.id === feedback.id ? feedback : item);
  } else {
    store.feedback.push(feedback);
  }
  await writeJson(path.join(projectDir, FEEDBACK_FILE), { feedback: store.feedback, updatedAt: nowIso() });
  await updateProjectStrategy(projectDir, feedback, store.feedback);
  return feedback;
}

export function feedbackToPrompt(feedback: ShootingFeedback): string {
  const shotRows = feedback.shotRecords.map((record) => [
    `镜头 ${record.order}`,
    record.label || "",
    `计划 ${record.plannedDurationSeconds ?? "未记录"} 秒`,
    `实际 ${record.actualDurationSeconds ?? "未记录"} 秒`,
    `结果 ${record.outcome}`,
    record.issue || "",
    record.note || "",
  ].filter(Boolean).join("｜"));
  const addedRows = feedback.addedShots.map((shot) => `- ${shot.label}${shot.actualDurationSeconds ? `（${shot.actualDurationSeconds} 秒）` : ""}${shot.reason ? `：${shot.reason}` : ""}`);
  return [
    `复盘标题：${feedback.title}`,
    feedback.shootDate ? `拍摄日期：${feedback.shootDate}` : "",
    feedback.location ? `拍摄地点：${feedback.location}` : "",
    shotRows.length ? `镜头计划/实际对照：\n${shotRows.join("\n")}` : "",
    addedRows.length ? `现场新增镜头：\n${addedRows.join("\n")}` : "",
    feedback.onSetIssues.length ? `现场问题：\n${feedback.onSetIssues.map((item) => `- ${item}`).join("\n")}` : "",
    feedback.overallNote ? `整体复盘：${feedback.overallNote}` : "",
    feedback.scriptAdjustments ? `脚本调整要求：${feedback.scriptAdjustments}` : "",
    feedback.storyboardAdjustments ? `分镜调整要求：${feedback.storyboardAdjustments}` : "",
    feedback.checklistAdjustments ? `拍摄清单调整要求：${feedback.checklistAdjustments}` : "",
  ].filter(Boolean).join("\n\n");
}

function lineStats(before: string, after: string): Pick<RevisionFileSummary, "lineAdded" | "lineRemoved"> {
  const left = before.split("\n");
  const right = after.split("\n");
  const common = Math.min(left.length, right.length);
  let same = 0;
  for (let index = 0; index < common; index += 1) if (left[index] === right[index]) same += 1;
  return { lineAdded: Math.max(0, right.length - same), lineRemoved: Math.max(0, left.length - same) };
}

export async function saveFeedbackRevision(
  slug: string,
  feedbackId: string,
  files: Array<{ filename: string; content: string }>,
  originals: ContentFile[],
): Promise<FeedbackRevision> {
  const projectDir = resolveProjectDirectory(slug);
  const revisionId = `rev_${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  const revisionDir = path.join(projectDir, REVISIONS_DIR, revisionId);
  await mkdir(revisionDir, { recursive: true });
  const summaries = files.map((file) => {
    const original = originals.find((item) => item.name === file.filename);
    const stats = lineStats(original?.content || "", file.content);
    return { filename: file.filename, originalFilename: file.filename, ...stats };
  });
  for (const file of files) await writeMarkdown(path.join(revisionDir, file.filename), file.content);
  const current = await readJson<FeedbackRevision[]>(path.join(projectDir, REVISION_INDEX), []);
  const revision: FeedbackRevision = {
    id: revisionId,
    createdAt: nowIso(),
    feedbackId,
    sourceFiles: files.map((file) => file.filename),
    files: summaries,
    directory: path.join(REVISIONS_DIR, revisionId),
    status: "ready",
  };
  await writeJson(path.join(projectDir, REVISION_INDEX), [...current, revision]);
  return revision;
}

export async function listFeedbackRevisions(slug: string): Promise<FeedbackRevision[]> {
  const projectDir = resolveProjectDirectory(slug);
  const revisions = await readJson<FeedbackRevision[]>(path.join(projectDir, REVISION_INDEX), []);
  return Array.isArray(revisions) ? revisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [];
}

export async function getFeedbackRevision(slug: string, revisionId: string): Promise<FeedbackRevision | undefined> {
  const revisions = await listFeedbackRevisions(slug);
  return revisions.find((revision) => revision.id === revisionId);
}

/** 将用户明确选择的 revision 写回项目根目录；调用方应在之后重建镜头任务。 */
export async function applyFeedbackRevision(slug: string, revisionId: string): Promise<FeedbackRevision> {
  const projectDir = resolveProjectDirectory(slug);
  const revision = await getFeedbackRevision(slug, revisionId);
  if (!revision) throw new Error("修订版本不存在。");
  for (const file of revision.files) {
    const source = path.join(projectDir, revision.directory, file.filename);
    const content = await readFile(source, "utf8");
    await writeMarkdown(path.join(projectDir, file.filename), content);
  }
  return revision;
}

export function shotRecordsFromTasks(tasks: ShotTask[]): ShotActualRecord[] {
  return tasks.map((task) => ({
    shotTaskId: task.id,
    order: task.order,
    label: task.visualDescription,
    plannedDurationSeconds: task.durationSeconds,
    outcome: task.status === "done" || task.status === "shot" ? "used" : "not_shot",
    note: task.notes,
  }));
}
