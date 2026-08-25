import { NextResponse } from "next/server";
import { apiError } from "../../_utils";
import { scanFinalVideos, resolveFinalVideoDirectories } from "../../../../../src/services/finalVideoWatcher.js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [videos, directories] = await Promise.all([
      scanFinalVideos(),
      resolveFinalVideoDirectories(),
    ]);
    const pending = videos.filter((v) => !v.dismissed && !v.sessionId);
    return NextResponse.json({
      ok: true,
      success: true,
      data: {
        videos: pending,
        directories,
        total: videos.length,
      },
    });
  } catch (error) {
    return apiError(error, "publisher", "成片扫描失败。", 500);
  }
}
