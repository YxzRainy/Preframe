import { NextResponse } from "next/server";
import { deleteTask, updateTask } from "../../../../../src/services/taskManager";
import { readRequestJson, apiError } from "../../_utils";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const patch: Parameters<typeof updateTask>[1] = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.completed === "boolean") patch.completed = body.completed;
    if (typeof body.priority === "string") patch.priority = body.priority as "low" | "medium" | "high";
    if (typeof body.dueDate === "string") patch.dueDate = body.dueDate;
    if (typeof body.projectSlug === "string") patch.projectSlug = body.projectSlug;
    const task = await updateTask(id, patch);
    return NextResponse.json({ ok: true, success: true, task });
  } catch (error) {
    return apiError(error, "task", "待办更新失败。", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteTask(id);
    return NextResponse.json({ ok: true, success: true });
  } catch (error) {
    return apiError(error, "task", "待办删除失败。", 400);
  }
}
