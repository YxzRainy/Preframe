import { NextResponse } from "next/server";
import { autoRepairProjectFile } from "../../../../../../../src/services/contentWorkflow";
import { apiError, assertSameOrigin, readRequestJson } from "../../../../_utils";
import { runWithWebModelAccess } from "../../../../../../lib/model-access";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const { slug } = await params;
    const body = await readRequestJson(request);
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    if (!fileName) throw new Error("缺少需要修复的文档名称。");
    const file = await runWithWebModelAccess(request, () => autoRepairProjectFile(slug, fileName));
    return NextResponse.json({ ok: true, success: true, file });
  } catch (error) {
    return apiError(error, "refine", "自动修复失败。", 400);
  }
}
