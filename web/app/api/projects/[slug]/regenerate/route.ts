import { NextResponse } from "next/server";
import { regenerateProjectDocuments } from "../../../../../../src/services/contentWorkflow";
import { apiError, assertSameOrigin, readRequestJson } from "../../../_utils";
import { runWithWebModelAccess } from "../../../../../lib/model-access";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const { slug } = await params;
    const body = await readRequestJson(request);
    const documents = Array.isArray(body.documents)
      ? body.documents.filter((value): value is string => typeof value === "string" && /^\d{1,2}$/u.test(value))
      : [];
    const result = await runWithWebModelAccess(body, () => regenerateProjectDocuments(slug, documents, { signal: request.signal }));
    return NextResponse.json({ ok: true, success: true, ...result });
  } catch (error) {
    return apiError(error, "generate", "异常文档重新生成失败。", 400);
  }
}
