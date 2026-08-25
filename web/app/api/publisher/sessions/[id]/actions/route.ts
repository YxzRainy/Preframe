import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { findSession } from "../../../../../../../src/services/publishSessionStore.js";
import { buildClipboardText } from "../../../../../../../src/services/platformVariantBuilder.js";
import {
  copyToClipboard,
  openCreatorBackend,
  openDirectory,
  revealInFinder,
} from "../../../../../../../src/services/systemActions.js";
import { resolveProjectDirectory } from "../../../../../../../src/services/projectManager.js";
import { PUBLISHER_PLATFORMS, type PublisherPlatform } from "../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";

type ActionKind =
  | "clipboard"
  | "clipboard-title"
  | "clipboard-body"
  | "clipboard-tags"
  | "backend"
  | "finder"
  | "finder-cover"
  | "open-project";

function isActionKind(value: unknown): value is ActionKind {
  return (
    typeof value === "string" &&
    [
      "clipboard",
      "clipboard-title",
      "clipboard-body",
      "clipboard-tags",
      "backend",
      "finder",
      "finder-cover",
      "open-project",
    ].includes(value)
  );
}
function isPlatform(value: unknown): value is PublisherPlatform {
  return typeof value === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(value);
}

/** 辅助操作：剪贴板（全部/标题/正文/标签）、打开后台、Finder 定位视频/封面、打开项目目录 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = isActionKind(body.action) ? body.action : "clipboard";
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);

    // 平台优先取 body.platform，否则当前 index
    const platform = isPlatform(body.platform)
      ? body.platform
      : session.targets[session.currentIndex]?.platform;
    if (!platform) return apiError(new Error("缺少 platform。"), "publisher", "缺少 platform。", 400);
    const target = session.targets.find((t) => t.platform === platform);
    if (!target) return apiError(new Error("发布目标不存在。"), "publisher", "发布目标不存在。", 404);

    if (action === "backend") {
      const result = await openCreatorBackend(platform);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    if (action === "finder") {
      const result = await revealInFinder(session.videoPath);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    if (action === "finder-cover") {
      const coverPath = target.thumbnailPath;
      if (!coverPath) {
        return NextResponse.json({
          ok: true,
          success: true,
          data: { action, result: { ok: false, method: "skip", error: "当前未选择封面" } },
        });
      }
      const result = await revealInFinder(coverPath);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    if (action === "open-project") {
      if (!session.projectSlug) {
        return NextResponse.json({
          ok: true,
          success: true,
          data: { action, result: { ok: false, method: "skip", error: "当前会话未关联项目" } },
        });
      }
      let projectDir: string;
      try {
        projectDir = resolveProjectDirectory(session.projectSlug);
      } catch (err) {
        return NextResponse.json({
          ok: true,
          success: true,
          data: {
            action,
            result: { ok: false, method: "skip", error: err instanceof Error ? err.message : "项目目录解析失败" },
          },
        });
      }
      const result = await openDirectory(projectDir);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }

    // 剪贴板操作
    let text: string;
    if (action === "clipboard-title") {
      text = target.title.trim();
    } else if (action === "clipboard-body") {
      text = target.description.trim();
    } else if (action === "clipboard-tags") {
      text = target.tags.map((t) => `#${t.replace(/^#+/, "")}`).join(" ");
    } else {
      text = buildClipboardText(target);
    }
    if (!text) {
      return NextResponse.json({
        ok: true,
        success: true,
        data: { action, result: { ok: false, method: "skip", error: "内容为空" } },
      });
    }
    const result = await copyToClipboard(text);
    return NextResponse.json({ ok: true, success: true, data: { action, result, clipboardText: text } });
  } catch (error) {
    return apiError(error, "publisher", "辅助操作失败。", 500);
  }
}
