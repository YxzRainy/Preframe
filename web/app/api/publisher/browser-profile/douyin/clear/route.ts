import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { findActiveByProfile } from "../../../../../../../src/services/publisherProcessStore.js";
import { rm } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/** 清除抖音登录状态（删除持久化 Profile 目录）。
 * 安全：若有活跃发布进程则拒绝；只删除指定 profile 目录，不触碰其他数据。 */
export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const profile = typeof body.profile === "string" ? body.profile : "primary";
    // 防路径穿越
    if (!/^[a-zA-Z0-9_@-]+$/.test(profile)) {
      return apiError(new Error("非法 profile 名。"), "publisher", "非法 profile 名。", 400);
    }

    // 互斥：有活跃进程时拒绝
    const active = await findActiveByProfile("douyin", profile);
    if (active) {
      return NextResponse.json(
        { ok: false, success: false, error: "有正在运行的抖音发布进程，请先取消再清除登录。", code: "ACTIVE_PROCESS" },
        { status: 409 },
      );
    }

    const preframeRoot = process.env.PREFRAME_ROOT || process.cwd();
    const profileDir = path.join(preframeRoot, ".piance", "browser-profiles", "douyin", profile);

    try {
      await rm(profileDir, { recursive: true, force: true });
    } catch {
      // 目录不存在视为已清除
    }

    return NextResponse.json({ ok: true, success: true, data: { cleared: true, profile } });
  } catch (error) {
    return apiError(error, "publisher", "清除抖音登录状态失败。", 500);
  }
}
