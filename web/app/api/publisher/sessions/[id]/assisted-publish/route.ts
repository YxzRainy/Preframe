import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { findSession } from "../../../../../../../src/services/publishSessionStore.js";
import { findActiveByProfile } from "../../../../../../../src/services/publisherProcessStore.js";
import { startDouyinWorker, retryDouyinWorker } from "../../../../../../../src/services/publisherWorkerClient.js";
import type { PublisherPlatform } from "../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_PLATFORMS = new Set(["douyin"]);

/** 启动 / 重试抖音半自动发布。
 *
 * 幂等：同一 profile 已有活跃进程时返回 409，防止双击。
 * POST = 启动；PATCH = 重试（先取消旧进程）。
 */
async function handle(id: string, request: Request, isRetry: boolean) {
  try {
    const body = await readRequestJson(request);
    const platform = (typeof body.platform === "string" ? body.platform : "douyin") as PublisherPlatform;
    if (!ALLOWED_PLATFORMS.has(platform)) {
      return apiError(new Error("本轮仅支持抖音。"), "publisher", "本轮仅支持抖音。", 400);
    }
    const profile = typeof body.profile === "string" ? body.profile : "primary";

    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);

    const target = session.targets.find((t) => t.platform === platform);
    if (!target) return apiError(new Error("该会话没有抖音目标。"), "publisher", "该会话没有抖音目标。", 404);

    // 幂等：已有活跃进程 → 409（重试除外，重试会先取消）
    if (!isRetry) {
      const active = await findActiveByProfile(platform, profile);
      if (active && active.sessionId === id) {
        return NextResponse.json(
          { ok: false, success: false, error: "已有正在运行的抖音发布进程。", code: "ACTIVE_PROCESS" },
          { status: 409 },
        );
      }
    }

    const result = isRetry
      ? await retryDouyinWorker({
          sessionId: id,
          platform,
          profile,
          target,
          videoPath: session.videoPath,
        })
      : await startDouyinWorker({
          sessionId: id,
          platform,
          profile,
          target,
          videoPath: session.videoPath,
        });

    if (!result.ok) {
      return apiError(new Error(result.error || "启动失败。"), "publisher", result.error || "启动失败。", 400);
    }

    const refreshed = await findSession(id);
    return NextResponse.json({
      ok: true,
      success: true,
      data: { session: refreshed, processId: result.processId },
    });
  } catch (error) {
    return apiError(error, "publisher", "启动抖音发布失败。", 500);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(id, request, false);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(id, request, true);
}
