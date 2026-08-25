import { NextResponse } from "next/server";
import { listTasks, createTask } from "../../../../src/services/taskManager";
import { readRequestJson, apiError } from "../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, tasks: await listTasks() });
  } catch (error) {
    return apiError(error, "task", "待办读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const title = typeof body.title === "string" ? body.title : "";
    if (!title.trim()) throw new Error("待办标题不能为空。");
    const task = await createTask({
      title,
      priority: typeof body.priority === "string" ? (body.priority as "low" | "medium" | "high") : "medium",
      dueDate: typeof body.dueDate === "string" ? body.dueDate : undefined,
      projectSlug: typeof body.projectSlug === "string" ? body.projectSlug : undefined,
    });
    return NextResponse.json({ ok: true, success: true, task });
  } catch (error) {
    return apiError(error, "task", "待办创建失败。", 400);
  }
}
