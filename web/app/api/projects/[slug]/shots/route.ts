import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveProjectDirectory } from "../../../../../../src/services/projectManager";
import { readProject } from "../../../../../../src/services/projectReader";
import { buildShotTasks, mergeShotTaskState } from "../../../../../../src/services/shotTaskBuilder";
import { syncProjectDerivedState } from "../../../../../../src/services/projectLifecycle";
import type { ShotTask, ShotTaskStatus } from "../../../../../../src/types/shotTask";
import { apiError } from "../../../_utils";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// 读取 / 写入 project.json
// ---------------------------------------------------------------------------

async function readProjectJson(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(projectDir, "project.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function writeProjectJson(projectDir: string, data: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(projectDir, "project.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// GET — 读取镜头任务（不存在时自动从文档构建）
// ---------------------------------------------------------------------------

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const projectDir = resolveProjectDirectory(slug);
    const metadata = await readProjectJson(projectDir);

    // 如果已存在 shotTasks 则直接返回
    if (Array.isArray(metadata.shotTasks) && metadata.shotTasks.length > 0) {
      return NextResponse.json({ ok: true, success: true, shotTasks: metadata.shotTasks, source: "cached" });
    }

    // 按需构建：读取项目文档，解析出 shotTasks
    const project = await readProject(slug);
    const rebuilt = buildShotTasks(project.files);
    const previous = Array.isArray(metadata.shotTasks) ? metadata.shotTasks as ShotTask[] : [];
    const shotTasks = mergeShotTaskState(previous, rebuilt);

    // 持久化到 project.json
    if (shotTasks.length > 0) {
      metadata.shotTasks = shotTasks;
      await writeProjectJson(projectDir, metadata);
    }

    return NextResponse.json({ ok: true, success: true, shotTasks, source: "built" });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "镜头任务读取失败。", status);
  }
}

// ---------------------------------------------------------------------------
// POST — 强制重新构建镜头任务（仅覆盖 project.json 中的 shotTasks，不触碰 Markdown）
// ---------------------------------------------------------------------------

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { shotTasks } = await syncProjectDerivedState(slug);

    return NextResponse.json({ ok: true, success: true, shotTasks, source: "rebuilt" });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "镜头任务重新构建失败。", status);
  }
}

// ---------------------------------------------------------------------------
// PATCH — 更新镜头任务
// ---------------------------------------------------------------------------

const VALID_STATUSES: ReadonlySet<string> = new Set<ShotTaskStatus>(["todo", "ready", "shot", "done"]);

interface ShotPatchPayload {
  id: string;
  status?: ShotTaskStatus;
  missingAssets?: string[];
  existingAssets?: string[];
  notes?: string;
}

function validatePatch(body: unknown): ShotPatchPayload[] {
  if (!body || typeof body !== "object") throw new Error("请求体格式无效。");

  const items: unknown[] = Array.isArray(body) ? body : [body];
  const patches: ShotPatchPayload[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("补丁条目格式无效。");
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.trim()) throw new Error("缺少镜头 id。");

    const patch: ShotPatchPayload = { id: record.id };

    if (record.status !== undefined) {
      if (typeof record.status !== "string" || !VALID_STATUSES.has(record.status)) {
        throw new Error(`无效状态：${String(record.status)}，允许值：todo / ready / shot / done`);
      }
      patch.status = record.status as ShotTaskStatus;
    }
    if (record.missingAssets !== undefined) {
      if (!Array.isArray(record.missingAssets) || !record.missingAssets.every((a: unknown) => typeof a === "string")) {
        throw new Error("missingAssets 必须为字符串数组。");
      }
      patch.missingAssets = record.missingAssets as string[];
    }
    if (record.existingAssets !== undefined) {
      if (!Array.isArray(record.existingAssets) || !record.existingAssets.every((a: unknown) => typeof a === "string")) {
        throw new Error("existingAssets 必须为字符串数组。");
      }
      patch.existingAssets = record.existingAssets as string[];
    }
    if (record.notes !== undefined) {
      if (typeof record.notes !== "string") throw new Error("notes 必须为字符串。");
      patch.notes = record.notes;
    }

    patches.push(patch);
  }

  if (!patches.length) throw new Error("至少需要一条补丁。");
  return patches;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const projectDir = resolveProjectDirectory(slug);
    const metadata = await readProjectJson(projectDir);

    if (!Array.isArray(metadata.shotTasks) || metadata.shotTasks.length === 0) {
      const project = await readProject(slug);
      metadata.shotTasks = buildShotTasks(project.files);
    }

    const tasks: ShotTask[] = metadata.shotTasks as ShotTask[];
    const body: unknown = await request.json();
    const patches = validatePatch(body);

    const updated: string[] = [];
    for (const patch of patches) {
      const task = tasks.find((t) => t.id === patch.id);
      if (!task) throw new Error(`镜头不存在：${patch.id}`);

      if (patch.status !== undefined) task.status = patch.status;
      if (patch.missingAssets !== undefined) task.missingAssets = patch.missingAssets;
      if (patch.existingAssets !== undefined) task.existingAssets = patch.existingAssets;
      if (patch.notes !== undefined) task.notes = patch.notes;

      updated.push(patch.id);
    }

    metadata.shotTasks = tasks;
    await writeProjectJson(projectDir, metadata);

    return NextResponse.json({ ok: true, success: true, updated, shotTasks: tasks });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "镜头任务更新失败。", status);
  }
}
