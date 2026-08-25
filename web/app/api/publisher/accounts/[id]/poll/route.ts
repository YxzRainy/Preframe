import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { findAccount, updateAccountStatus } from "../../../../../../../src/services/publisherAccountStore.js";
import { cookieExists, cookieMtime } from "../../../../../../../src/services/publisherBridgeClient.js";

export const runtime = "nodejs";

/** 轻量级登录状态轮询：仅检查 storage_state 文件是否已落盘，不调用 sau_cli。
 * 用于登录扫码期间的前端轮询，避免反复启动浏览器/网络请求。 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await findAccount(id);
    if (!account) return apiError(new Error("账号不存在。"), "publisher", "账号不存在。", 404);

    const exists = await cookieExists(account.platform, account.accountName);

    // 仅当账号处于 checking 且 cookie 已出现时，才推进为 logged_in
    if (account.status === "checking" && exists) {
      const mtime = await cookieMtime(account.platform, account.accountName);
      const updated = await updateAccountStatus(id, "logged_in", "扫码登录成功");
      return NextResponse.json({
        ok: true,
        success: true,
        data: { account: updated, cookieExists: true, cookieMtime: mtime, justLoggedIn: true },
      });
    }

    return NextResponse.json({
      ok: true,
      success: true,
      data: { account, cookieExists: exists, justLoggedIn: false },
    });
  } catch (error) {
    return apiError(error, "publisher", "登录状态轮询失败。", 500);
  }
}
