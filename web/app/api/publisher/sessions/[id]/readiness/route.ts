import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { findSession, setReadiness } from "../../../../../../../src/services/publishSessionStore.js";
import { computeReadinessForSession } from "../../../../../../../src/services/publishReadiness.js";

export const runtime = "nodejs";

/** 重新计算并返回会话的发布就绪度 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    const readiness = await computeReadinessForSession(session);
    const updated = await setReadiness(id, readiness);
    return NextResponse.json({
      ok: true,
      success: true,
      data: { readiness, session: updated },
    });
  } catch (error) {
    return apiError(error, "publisher", "就绪度检查失败。", 500);
  }
}
