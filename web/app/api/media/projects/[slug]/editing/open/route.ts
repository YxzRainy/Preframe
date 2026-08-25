import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../_utils";
import {
  copyToClipboard,
  openDirectory,
  openInDefaultPlayer,
  revealInFinder,
} from "../../../../../../../../src/services/systemActions.js";

export const runtime = "nodejs";

type EditingAction = "reveal" | "open" | "open-dir" | "copy-path";

function isAction(v: unknown): v is EditingAction {
  return typeof v === "string" && ["reveal", "open", "open-dir", "copy-path"].includes(v);
}

/** POST — 对剪辑工作区中的任意路径（原素材 / proxy / editing 目录）执行真实系统动作
 * body: { action, path }  使用 spawn 参数数组，禁止 exec / shell 拼接 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    void params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = isAction(body.action) ? body.action : "reveal";
    const targetPath = typeof body.path === "string" ? body.path : "";
    if (!targetPath) return apiError(new Error("缺少 path。"), "media", "缺少 path。", 400);

    if (action === "copy-path") {
      const result = await copyToClipboard(targetPath);
      return NextResponse.json({ ok: true, success: true, data: { action, result, path: targetPath } });
    }
    if (action === "open") {
      const result = await openInDefaultPlayer(targetPath);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    if (action === "open-dir") {
      const result = await openDirectory(targetPath);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    const result = await revealInFinder(targetPath);
    return NextResponse.json({ ok: true, success: true, data: { action, result } });
  } catch (error) {
    return apiError(error, "media", "系统操作失败。", 500);
  }
}
