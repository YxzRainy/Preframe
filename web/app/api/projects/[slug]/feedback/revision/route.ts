import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { FEEDBACK_REVISION_FILES } from "../../../../../../../src/prompts/feedbackRevisionPrompt";
import { getFeedbackRevision, applyFeedbackRevision } from "../../../../../../../src/services/shootingFeedback";
import { resolveProjectDirectory } from "../../../../../../../src/services/projectManager";
import { syncProjectDerivedState } from "../../../../../../../src/services/projectLifecycle";
import { apiError, readRequestJson } from "../../../../_utils";

export const runtime = "nodejs";

function safeRevisionId(value: string): boolean {
  return /^rev_[A-Za-z0-9_-]+$/u.test(value);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const revisionId = url.searchParams.get("revisionId") || "";
    const filename = url.searchParams.get("file") || "";
    if (!safeRevisionId(revisionId) || !FEEDBACK_REVISION_FILES.includes(filename as (typeof FEEDBACK_REVISION_FILES)[number])) throw new Error("修订文件参数无效。");
    const revision = await getFeedbackRevision(slug, revisionId);
    if (!revision) return NextResponse.json({ ok: false, success: false, error: "修订版本不存在。" }, { status: 404 });
    const target = path.join(resolveProjectDirectory(slug), revision.directory, filename);
    const content = await readFile(target, "utf8");
    return new NextResponse(content, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"` } });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "feedback", "修订文件读取失败。", status);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const revisionId = typeof body.revisionId === "string" ? body.revisionId : "";
    if (!safeRevisionId(revisionId)) throw new Error("修订版本参数无效。");
    const revision = await applyFeedbackRevision(slug, revisionId);

    const { shotTasks } = await syncProjectDerivedState(slug);
    return NextResponse.json({ ok: true, success: true, revision, shotTasks });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "feedback", "应用修订版本失败。", status);
  }
}
