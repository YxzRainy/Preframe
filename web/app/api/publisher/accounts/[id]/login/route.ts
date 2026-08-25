import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { findAccount, updateAccountStatus } from "../../../../../../../src/services/publisherAccountStore.js";
import { assertBridgeAvailable, loginAccount } from "../../../../../../../src/services/publisherBridgeClient.js";

export const runtime = "nodejs";

/** 启动登录：detached 启动桥接进程（浏览器在用户桌面打开扫码），立即返回。
 * 登录是否完成需随后调用 validate 检查 cookie 是否落盘。 */
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

    // 标记检查中（持久化），前端据此禁用按钮
    await updateAccountStatus(id, "checking", "登录浏览器启动中，请扫码");

    // detached 启动 — 不等待登录完成
    await loginAccount(account.accountName);

    return NextResponse.json({
      ok: true,
      success: true,
      data: { account: { ...account, status: "checking" }, message: "登录浏览器已启动，请扫码后点击「检查状态」。" },
    });
  } catch (error) {
    return apiError(error, "publisher", "登录启动失败。", 500);
  }
}
