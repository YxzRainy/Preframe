import { NextResponse } from "next/server";
import { apiError } from "../../../../../_utils";
import { findSession, updateTargetAssisted } from "../../../../../../../../src/services/publishSessionStore.js";
import { cancelWorkerForTarget } from "../../../../../../../../src/services/publisherWorkerClient.js";
import type { PublisherPlatform } from "../../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

/** 取消抖音半自动发布进程。
 * SIGTERM → worker 走 finally 关闭浏览器 → 退出。宽限期后 SIGKILL。 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      /* 允许空 body */
    }
    const platform = (typeof body.platform === "string" ? body.platform : "douyin") as PublisherPlatform;

    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);

    await cancelWorkerForTarget(id, platform, "用户取消");

    // 即便 worker 已退出，也把 target 标记为 cancelled
    await updateTargetAssisted(id, platform, { assistedStatus: "cancelled", assistedError: undefined });
    const refreshed = await findSession(id);
    return NextResponse.json({ ok: true, success: true, data: { session: refreshed } });
  } catch (error) {
    return apiError(error, "publisher", "取消抖音发布失败。", 500);
  }
}
