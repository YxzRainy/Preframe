import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { focusBrowserWindow } from "../../../../../../../src/services/systemActions.js";

export const runtime = "nodejs";

/** 聚焦 worker 启动的浏览器窗口（macOS osascript activate）。用于「查看浏览器」按钮。 */
export async function POST() {
  try {
    const result = await focusBrowserWindow();
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, success: false, error: result.error || "未找到浏览器进程", method: result.method },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, success: true, data: { method: result.method } });
  } catch (error) {
    return apiError(error, "publisher", "聚焦浏览器失败。", 500);
  }
}
