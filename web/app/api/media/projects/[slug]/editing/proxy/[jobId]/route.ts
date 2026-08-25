import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../../_utils";
import { cancelProxyJob, retryProxyJob } from "../../../../../../../../../src/services/proxyManager.js";

export const runtime = "nodejs";

/** POST — 取消 / 重试 proxy 任务
 * body.action: "cancel" | "retry" */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; jobId: string }> }) {
  try {
    const { jobId } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = typeof body.action === "string" ? body.action : "cancel";

    const result = action === "retry" ? await retryProxyJob(jobId) : await cancelProxyJob(jobId);
    if (!result.ok) return apiError(new Error(result.reason), "media", result.reason, 400);
    return NextResponse.json({ ok: true, success: true, reason: result.reason });
  } catch (error) {
    return apiError(error, "media", "Proxy 任务操作失败。", 400);
  }
}
