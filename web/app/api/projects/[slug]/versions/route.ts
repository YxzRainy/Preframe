import { NextResponse } from "next/server";
import {
  lineDiff,
  listDocumentVersions,
  readDocumentVersion,
  rollbackDocumentVersion,
} from "../../../../../../src/services/documentVersionStore";
import { syncProjectDerivedState } from "../../../../../../src/services/projectLifecycle";
import { apiError, readRequestJson } from "../../../_utils";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const query = new URL(request.url).searchParams;
    const fileName = query.get("fileName") || "";
    const from = query.get("from");
    const to = query.get("to");
    if (from && to) {
      const [before, after] = await Promise.all([
        readDocumentVersion(slug, fileName, from),
        readDocumentVersion(slug, fileName, to),
      ]);
      return NextResponse.json({ ok: true, success: true, diff: lineDiff(before, after) });
    }
    return NextResponse.json({ ok: true, success: true, versions: await listDocumentVersions(slug, fileName) });
  } catch (error) {
    return apiError(error, "project", "文档版本读取失败。", 400);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const versionId = typeof body.versionId === "string" ? body.versionId : "";
    await rollbackDocumentVersion(slug, fileName, versionId);
    await syncProjectDerivedState(slug);
    return NextResponse.json({ ok: true, success: true });
  } catch (error) {
    return apiError(error, "project", "文档版本回滚失败。", 400);
  }
}
