import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../_utils";
import { dismissVideo, restoreVideo } from "../../../../../../src/services/finalVideoStore.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const videoPath = typeof body.videoPath === "string" ? body.videoPath.trim() : "";
    if (!videoPath) return apiError(new Error("缺少 videoPath。"), "publisher", "缺少 videoPath。", 400);
    const restore = body.restore === true;
    const record = restore ? await restoreVideo(videoPath) : await dismissVideo(videoPath);
    return NextResponse.json({ ok: true, success: true, data: { record } });
  } catch (error) {
    return apiError(error, "publisher", "成片忽略操作失败。", 400);
  }
}
