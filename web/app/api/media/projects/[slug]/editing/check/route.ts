import { NextResponse } from "next/server";
import { apiError } from "../../../../../_utils";
import { checkEditingAssets } from "../../../../../../../../src/services/assetChecker.js";

export const runtime = "nodejs";

/** GET — 快速素材健康检查 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const result = await checkEditingAssets(slug);
    return NextResponse.json({ ok: true, success: true, ...result });
  } catch (error) {
    return apiError(error, "media", "素材检查失败。", 400);
  }
}
