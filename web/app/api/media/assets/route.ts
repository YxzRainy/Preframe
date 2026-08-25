import { NextResponse } from "next/server";
import { apiError } from "../../_utils";
import { scanMediaAssets } from "../../../../../src/services/mediaAssetScanner.js";
import { readMediaAssets } from "../../../../../src/services/mediaAssetStore.js";

export const runtime = "nodejs";

/** GET — 列出已扫描素材（不触发新扫描）。
 *  查询参数 ?scan=1 触发一次扫描（稳定性检测 + ffprobe + 去重）。 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const shouldScan = url.searchParams.get("scan") === "1";

    if (shouldScan) {
      const result = await scanMediaAssets();
      return NextResponse.json({
        ok: true,
        success: true,
        assets: result.assets,
        capability: result.capability,
        scannedAt: result.scannedAt,
        directories: result.directories,
        newCount: result.newCount,
      });
    }

    const assets = await readMediaAssets();
    return NextResponse.json({ ok: true, success: true, assets });
  } catch (error) {
    return apiError(error, "media", "素材扫描失败。", 500);
  }
}
