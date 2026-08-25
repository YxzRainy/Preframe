import { NextResponse } from "next/server";
import { apiError } from "../../../../../_utils";
import { findSession, updateTargetAssisted } from "../../../../../../../../src/services/publishSessionStore.js";
import type { PublisherPlatform } from "../../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

/** 用户确认「我已发布」。
 * 由用户在浏览器人工点击最终发布按钮后标记，系统不自动点击。 */
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
    const target = session.targets.find((t) => t.platform === platform);
    if (!target) return apiError(new Error("该会话没有该平台目标。"), "publisher", "该会话没有该平台目标。", 404);

    // confirmed 会同步 target.status=published 并推进会话完成度
    const updated = await updateTargetAssisted(id, platform, {
      assistedStatus: "confirmed",
      assistedError: undefined,
    });

    return NextResponse.json({ ok: true, success: true, data: { session: updated } });
  } catch (error) {
    return apiError(error, "publisher", "确认发布失败。", 500);
  }
}
