import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import { matchProject, shouldAutoSelect } from "../../../../../src/services/projectMatch.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const videoPath = typeof body.videoPath === "string" ? body.videoPath.trim() : "";
    if (!videoPath) return apiError(new Error("缺少 videoPath。"), "publisher", "缺少 videoPath。", 400);
    const candidates = await matchProject({ videoPath });
    const autoSelect = shouldAutoSelect(candidates);
    return NextResponse.json({
      ok: true,
      success: true,
      data: { candidates, autoSelect: autoSelect?.projectSlug || null },
    });
  } catch (error) {
    return apiError(error, "publisher", "项目匹配失败。", 500);
  }
}
