import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../_utils";
import { deleteSession, findSession, updateSession } from "../../../../../../src/services/publishSessionStore.js";
import type { PublishSessionStatus } from "../../../../../../src/types/publishSession.js";

export const runtime = "nodejs";

const STATUSES: readonly PublishSessionStatus[] = ["ready", "running", "paused", "completed", "archived"];

function isStatus(value: unknown): value is PublishSessionStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    return NextResponse.json({ ok: true, success: true, data: { session } });
  } catch (error) {
    return apiError(error, "publisher", "发布会话读取失败。", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const input: { status?: PublishSessionStatus; currentIndex?: number } = {};
    if (isStatus(body.status)) input.status = body.status;
    if (typeof body.currentIndex === "number") input.currentIndex = body.currentIndex;
    const session = await updateSession(id, input);
    return NextResponse.json({ ok: true, success: true, data: { session } });
  } catch (error) {
    return apiError(error, "publisher", "发布会话更新失败。", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteSession(id);
    return NextResponse.json({ ok: true, success: true, data: { deleted: true } });
  } catch (error) {
    return apiError(error, "publisher", "发布会话删除失败。", 400);
  }
}
