import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../../_utils";
import { markTargetManuallyPublished } from "../../../../../../../../../src/services/publishPreparationStore.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  try {
    const { id, targetId } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const published = body.published !== false; // 默认 true；传 false 取消标记
    const result = body.result === "failed" ? "failed" : published ? "published" : undefined;
    const preparation = await markTargetManuallyPublished(id, targetId, published, {
      result,
      publishUrl: typeof body.publishUrl === "string" ? body.publishUrl : undefined,
      publishNote: typeof body.publishNote === "string" ? body.publishNote : undefined,
    });
    return NextResponse.json({ ok: true, success: true, data: { preparation } });
  } catch (error) {
    return apiError(error, "publisher", "手动发布标记失败。", 400);
  }
}
