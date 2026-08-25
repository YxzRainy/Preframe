import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { listAccounts } from "../../../../../../../src/services/publisherAccountStore.js";
import { findJob, updateJob, updateTargetStatus } from "../../../../../../../src/services/publishJobStore.js";
import type { PublishTargetStatus } from "../../../../../../../src/types/publisher.js";
import { assertBridgeAvailable, dryRunPublish } from "../../../../../../../src/services/publisherBridgeClient.js";

export const runtime = "nodejs";

function mapDryRunResult(result: Awaited<ReturnType<typeof dryRunPublish>>): { status: PublishTargetStatus; error?: string } {
  if (result.success) return { status: "ready" };
  if (result.timedOut) return { status: "failed", error: "检查超时" };
  const stage = result.stage;
  const cookieExists = result.data ? Boolean(result.data.cookie_exists) : false;
  if (stage === "cookie_check" || cookieExists === false) return { status: "requires_login", error: "未登录，请先扫码登录" };
  if (stage === "video_check") return { status: "failed", error: "视频文件不存在" };
  if (stage === "title_check") return { status: "failed", error: "标题为空" };
  return { status: "failed", error: result.error || "检查失败" };
}

/** 对任务内每个账号依次执行 dry-run 预检。一个账号失败不影响其他账号。 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = await findJob(id);
    if (!job) return apiError(new Error("发布任务不存在。"), "publisher", "发布任务不存在。", 404);

    try {
      await assertBridgeAvailable();
    } catch (error) {
      return apiError(error, "publisher", error instanceof Error ? error.message : "桥接层不可用。", 500);
    }

    const accounts = await listAccounts();
    const nameById = new Map(accounts.map((acc) => [acc.id, acc.accountName]));
    const statusById = new Map(accounts.map((acc) => [acc.id, acc.status]));

    // 标记任务进入检查中
    await updateJob(id, { status: "validating" });

    for (const target of job.targets) {
      const accountName = nameById.get(target.accountId);
      if (!accountName) {
        await updateTargetStatus(id, target.id, "failed", "账号已删除");
        continue;
      }
      // 产品逻辑限制：账号未登录时不允许执行 Dry Run，直接标记需登录
      if (statusById.get(target.accountId) !== "logged_in") {
        await updateTargetStatus(id, target.id, "requires_login", "需要登录：该账号尚未扫码登录");
        continue;
      }
      // 标记当前账号检查中（前端可看到进度）
      await updateTargetStatus(id, target.id, "validating");
      try {
        const result = await dryRunPublish({
          accountName,
          videoPath: job.videoPath,
          title: target.title,
          description: target.description,
          tags: target.tags,
        });
        const mapped = mapDryRunResult(result);
        await updateTargetStatus(id, target.id, mapped.status, mapped.error);
      } catch (error) {
        await updateTargetStatus(id, target.id, "failed", error instanceof Error ? error.message : "检查异常");
      }
    }

    // 重新读取聚合后的任务状态
    const updated = await findJob(id);
    return NextResponse.json({ ok: true, success: true, data: { job: updated } });
  } catch (error) {
    return apiError(error, "publisher", "Dry Run 执行失败。", 500);
  }
}
