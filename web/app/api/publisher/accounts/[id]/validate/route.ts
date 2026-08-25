import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { findAccount, updateAccountStatus } from "../../../../../../../src/services/publisherAccountStore.js";
import type { PublisherAccountStatus } from "../../../../../../../src/types/publisher.js";
import { assertBridgeAvailable, validateAccount } from "../../../../../../../src/services/publisherBridgeClient.js";

export const runtime = "nodejs";

/** 同步校验 cookie 有效性，根据桥接结果更新账号状态。 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await findAccount(id);
    if (!account) return apiError(new Error("账号不存在。"), "publisher", "账号不存在。", 404);

    try {
      await assertBridgeAvailable();
    } catch (error) {
      return apiError(error, "publisher", error instanceof Error ? error.message : "桥接层不可用。", 500);
    }

    await updateAccountStatus(id, "checking", "正在检查登录状态");

    const result = await validateAccount(account.accountName);

    let status: PublisherAccountStatus;
    let message: string | undefined;
    const cookieExists = result.data ? Boolean(result.data.cookie_exists) : false;

    if (result.success) {
      status = "logged_in";
      message = "登录状态有效";
    } else if (result.timedOut) {
      status = "error";
      message = "检查超时，请重试";
    } else if (result.stage === "cookie_check" || cookieExists === false) {
      status = "not_logged_in";
      message = "未登录，请先扫码登录";
    } else {
      // cookie 存在但校验失败 → 已过期
      status = "expired";
      message = result.error || "登录已过期，请重新登录";
    }

    const updated = await updateAccountStatus(id, status, message);
    return NextResponse.json({ ok: true, success: true, data: { account: updated } });
  } catch (error) {
    return apiError(error, "publisher", "登录状态检查失败。", 500);
  }
}
