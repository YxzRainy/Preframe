import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { findSession, selectCover, updateCoverCandidates } from "../../../../../../../src/services/publishSessionStore.js";
import { findCoverCandidates } from "../../../../../../../src/services/coverMatcher.js";

export const runtime = "nodejs";

/** 读取当前封面候选与已选封面 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    const selectedCover = session.targets.find((t) => t.thumbnailPath)?.thumbnailPath || null;
    return NextResponse.json({
      ok: true,
      success: true,
      data: {
        candidates: session.coverCandidates || [],
        selectedCover,
      },
    });
  } catch (error) {
    return apiError(error, "publisher", "封面信息读取失败。", 500);
  }
}

/** 重新扫描封面候选 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const projectSlug = typeof body.projectSlug === "string" && body.projectSlug.trim()
      ? body.projectSlug.trim()
      : session.projectSlug;
    const match = await findCoverCandidates({ videoPath: session.videoPath, projectSlug });
    const updated = await updateCoverCandidates(id, match.candidates);
    return NextResponse.json({
      ok: true,
      success: true,
      data: {
        candidates: match.candidates,
        autoSelect: match.autoSelect,
        selectedCover: updated.targets.find((t) => t.thumbnailPath)?.thumbnailPath || null,
      },
    });
  } catch (error) {
    return apiError(error, "publisher", "封面扫描失败。", 500);
  }
}

/** 选定某个封面路径（写入所有 target） */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const coverPath = typeof body.coverPath === "string" ? body.coverPath.trim() : "";
    if (!coverPath) return apiError(new Error("缺少 coverPath。"), "publisher", "缺少 coverPath。", 400);
    const session = await selectCover(id, coverPath);
    return NextResponse.json({ ok: true, success: true, data: { session } });
  } catch (error) {
    return apiError(error, "publisher", "封面选择失败。", 500);
  }
}
