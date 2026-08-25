import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import {
  addWatchedDirectory,
  readMediaPreferences,
  removeWatchedDirectory,
  toggleWatchedDirectory,
  writeMediaPreferences,
} from "../../../../../src/services/mediaPreferences.js";

export const runtime = "nodejs";

/** GET — 读取素材监听目录配置 */
export async function GET() {
  try {
    const preferences = await readMediaPreferences();
    return NextResponse.json({ ok: true, success: true, preferences });
  } catch (error) {
    return apiError(error, "media", "素材监听配置读取失败。", 500);
  }
}

/** PUT — 更新配置（整体替换 / 增删 / 启停） */
export async function PUT(request: Request) {
  try {
    const body = await readRequestJson(request);
    const action = typeof body.action === "string" ? body.action : "replace";

    if (action === "add") {
      const dirPath = typeof body.path === "string" ? body.path.trim() : "";
      if (!dirPath) return apiError(new Error("目录路径不能为空。"), "media", "目录路径不能为空。", 400);
      const preferences = await addWatchedDirectory(dirPath);
      return NextResponse.json({ ok: true, success: true, preferences });
    }
    if (action === "remove") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return apiError(new Error("缺少目录 id。"), "media", "缺少目录 id。", 400);
      const preferences = await removeWatchedDirectory(id);
      return NextResponse.json({ ok: true, success: true, preferences });
    }
    if (action === "toggle") {
      const id = typeof body.id === "string" ? body.id : "";
      const enabled = body.enabled !== false;
      if (!id) return apiError(new Error("缺少目录 id。"), "media", "缺少目录 id。", 400);
      const preferences = await toggleWatchedDirectory(id, enabled);
      return NextResponse.json({ ok: true, success: true, preferences });
    }

    // 默认：整体替换
    if (!Array.isArray(body.watchedDirectories)) {
      return apiError(new Error("watchedDirectories 必须为数组。"), "media", "watchedDirectories 必须为数组。", 400);
    }
    const preferences = await writeMediaPreferences({
      watchedDirectories: body.watchedDirectories as Array<{ id?: string; path: string; enabled?: boolean }>,
    });
    return NextResponse.json({ ok: true, success: true, preferences });
  } catch (error) {
    return apiError(error, "media", "素材监听配置更新失败。", 500);
  }
}
