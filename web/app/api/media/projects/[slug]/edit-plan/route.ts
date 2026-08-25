import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { buildEditPlan } from "../../../../../../../src/services/editPlanBuilder.js";

export const runtime = "nodejs";

/** POST — 生成剪辑准备清单（editing/EDIT_PLAN.json + 剪辑准备.md），仅引用原素材路径 */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const result = await buildEditPlan(slug);
    return NextResponse.json({
      ok: true,
      success: true,
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath,
      plan: result.plan,
    });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "media", "剪辑准备清单生成失败。", status);
  }
}
