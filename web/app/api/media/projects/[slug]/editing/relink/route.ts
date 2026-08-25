import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../_utils";
import {
  relinkFromDirectory,
  confirmAmbiguousRelink,
} from "../../../../../../../../src/services/mediaRelinker.js";

export const runtime = "nodejs";

/** POST — 素材路径重连
 * body.action: "scan"（默认，body.directory 递归扫描重连）| "confirm"（人工确认 body.assetId + body.path） */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = typeof body.action === "string" ? body.action : "scan";

    if (action === "confirm") {
      const assetId = typeof body.assetId === "string" ? body.assetId : "";
      const newPath = typeof body.path === "string" ? body.path : "";
      if (!assetId || !newPath) return apiError(new Error("缺少 assetId 或 path。"), "media", "缺少 assetId 或 path。", 400);
      const result = await confirmAmbiguousRelink(slug, assetId, newPath);
      if (!result.ok) return apiError(new Error(result.reason), "media", result.reason, 400);
      return NextResponse.json({ ok: true, success: true, reason: result.reason });
    }

    const directory = typeof body.directory === "string" ? body.directory : "";
    if (!directory) return apiError(new Error("缺少 directory。"), "media", "缺少 directory。", 400);
    const result = await relinkFromDirectory(slug, directory);
    return NextResponse.json({ ok: true, success: true, ...result });
  } catch (error) {
    return apiError(error, "media", "素材重连失败。", 400);
  }
}
