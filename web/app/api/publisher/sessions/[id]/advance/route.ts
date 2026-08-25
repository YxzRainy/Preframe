import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { advanceToNextPending, findSession, updateTargetStatus } from "../../../../../../../src/services/publishSessionStore.js";
import { buildClipboardText } from "../../../../../../../src/services/publishContentReader.js";
import { copyToClipboard, openCreatorBackend, revealInFinder } from "../../../../../../../src/services/systemActions.js";
import { updateStage, updatePublishData } from "../../../../../../../src/services/projectStage.js";

export const runtime = "nodejs";

/** 标记当前平台已发布，自动进入下一平台（复制文案 + 打开后台 + Finder） */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    const currentTarget = session.targets[session.currentIndex];
    if (!currentTarget) return apiError(new Error("当前无平台目标。"), "publisher", "当前无平台目标。", 400);

    // 1. 当前平台标记已发布
    await updateTargetStatus(id, currentTarget.platform, {
      status: "published",
      publishedAt: new Date().toISOString(),
    });

    // 2. 推进到下一未完成平台
    const advanced = await advanceToNextPending(id);
    const nextTarget = advanced.targets[advanced.currentIndex];

    // 3. 若已全部完成 → 项目阶段推进 published
    if (advanced.status === "completed") {
      if (advanced.projectSlug) {
        try {
          await updatePublishData(advanced.projectSlug, {
            publishedAt: advanced.firstPublishedAt || new Date().toISOString(),
          });
          await updateStage(advanced.projectSlug, "published");
        } catch {
          // 阶段推进失败不阻断
        }
      }
      return NextResponse.json({
        ok: true,
        success: true,
        data: { session: advanced, completed: true, actions: null },
      });
    }

    // 4. 下一平台：复制文案 + 打开后台 + Finder
    if (!nextTarget || nextTarget.status === "published" || nextTarget.status === "skipped") {
      return NextResponse.json({ ok: true, success: true, data: { session: advanced, completed: false, actions: null } });
    }
    const clipboardText = buildClipboardText(nextTarget);
    const [clipboardResult, backendResult, finderResult] = await Promise.all([
      copyToClipboard(clipboardText),
      openCreatorBackend(nextTarget.platform),
      revealInFinder(advanced.videoPath),
    ]);
    await updateTargetStatus(id, nextTarget.platform, { status: "opened", openedAt: new Date().toISOString() });

    // 重新获取会话以反映最新的 target 状态
    const refreshed = await findSession(id);

    return NextResponse.json({
      ok: true,
      success: true,
      data: {
        session: refreshed ?? advanced,
        completed: false,
        actions: {
          clipboard: clipboardResult,
          backend: backendResult,
          finder: finderResult,
          clipboardText,
        },
      },
    });
  } catch (error) {
    return apiError(error, "publisher", "推进发布会话失败。", 500);
  }
}
