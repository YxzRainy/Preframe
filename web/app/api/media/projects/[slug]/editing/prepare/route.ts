import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../_utils";
import {
  prepareEditingWorkspace,
  renameEditingSymlinks,
} from "../../../../../../../../src/services/editingPrepBuilder.js";

export const runtime = "nodejs";

/** POST — 一键准备剪辑工作区：创建 editing 目录 + symlink 原素材 + 写 manifest
 * body.action: "prepare"（默认）| "rename"（重新生成剪辑友好名） */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = typeof body.action === "string" ? body.action : "prepare";

    if (action === "rename") {
      const result = await renameEditingSymlinks(slug);
      return NextResponse.json({
        ok: true,
        success: true,
        renamed: result.renamed,
        skipped: result.skipped,
      });
    }

    const result = await prepareEditingWorkspace(slug);
    return NextResponse.json({
      ok: true,
      success: true,
      manifest: result.manifest,
      createdDirs: result.createdDirs,
      symlinkCount: result.symlinkCount,
      symlinkFailed: result.symlinkFailed,
    });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "media", "剪辑工作区准备失败。", status);
  }
}
