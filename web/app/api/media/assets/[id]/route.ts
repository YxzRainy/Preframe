import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../_utils";
import { readMediaAssets } from "../../../../../../src/services/mediaAssetStore.js";
import {
  copyToClipboard,
  openDirectory,
  openInDefaultPlayer,
  revealInFinder,
} from "../../../../../../src/services/systemActions.js";
import path from "node:path";

export const runtime = "nodejs";

type AssetAction = "reveal" | "open" | "open-dir" | "copy-path";

function isAction(value: unknown): value is AssetAction {
  return typeof value === "string" && ["reveal", "open", "open-dir", "copy-path"].includes(value);
}

/** POST — 对单个素材执行真实系统动作
 *  - reveal: Finder 中定位
 *  - open: 系统默认播放器打开
 *  - open-dir: 打开素材所在目录
 *  - copy-path: 复制文件路径 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = isAction(body.action) ? body.action : "reveal";

    const assets = await readMediaAssets();
    const asset = assets.find((a) => a.id === id);
    if (!asset) return apiError(new Error("素材不存在。"), "media", "素材不存在。", 404);

    if (action === "copy-path") {
      const result = await copyToClipboard(asset.path);
      return NextResponse.json({ ok: true, success: true, data: { action, result, path: asset.path } });
    }
    if (action === "open") {
      const result = await openInDefaultPlayer(asset.path);
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    if (action === "open-dir") {
      const result = await openDirectory(path.dirname(asset.path));
      return NextResponse.json({ ok: true, success: true, data: { action, result } });
    }
    // reveal
    const result = await revealInFinder(asset.path);
    return NextResponse.json({ ok: true, success: true, data: { action, result } });
  } catch (error) {
    return apiError(error, "media", "素材操作失败。", 500);
  }
}
