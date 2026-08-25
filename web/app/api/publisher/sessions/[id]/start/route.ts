import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { findSession, updateSession, updateTargetStatus } from "../../../../../../../src/services/publishSessionStore.js";
import { buildClipboardText } from "../../../../../../../src/services/publishContentReader.js";
import { copyToClipboard, openCreatorBackend, revealInFinder } from "../../../../../../../src/services/systemActions.js";

export const runtime = "nodejs";

/** 开始当前平台：复制文案 + 打开后台 + Finder 定位视频 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    const target = session.targets[session.currentIndex];
    if (!target) return apiError(new Error("当前无可用平台目标。"), "publisher", "当前无可用平台目标。", 400);

    // 1. 复制文案到剪贴板
    const clipboardText = buildClipboardText(target);
    const clipboardResult = await copyToClipboard(clipboardText);

    // 2. 打开官方后台
    const backendResult = await openCreatorBackend(target.platform);

    // 3. Finder 定位视频
    const finderResult = await revealInFinder(session.videoPath);

    // 4. 更新 target 状态为 opened
    await updateTargetStatus(id, target.platform, { status: "opened", openedAt: new Date().toISOString() });
    // 5. 会话进入 running
    const updated = await updateSession(id, { status: "running" });

    return NextResponse.json({
      ok: true,
      success: true,
      data: {
        session: updated,
        actions: {
          clipboard: clipboardResult,
          backend: backendResult,
          finder: finderResult,
          clipboardText,
        },
      },
    });
  } catch (error) {
    return apiError(error, "publisher", "开始发布失败。", 500);
  }
}
