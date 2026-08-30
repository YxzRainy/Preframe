import { NextResponse } from "next/server";
import { assembleContentAssets, getContentAssetStore, rebuildContentAssets } from "../../../../src/services/contentAssetStore";
import { apiError, assertSameOrigin, readRequestJson } from "../_utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    const assets = await getContentAssetStore();
    const assembly = query ? await assembleContentAssets(query) : undefined;
    return NextResponse.json({ ok: true, success: true, assets, assembly });
  } catch (error) {
    return apiError(error, "assets", "内容资产读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    if (body.action === "rebuild") {
      const assets = await rebuildContentAssets();
      return NextResponse.json({ ok: true, success: true, assets });
    }
    if (body.action === "assemble") {
      const query = typeof body.query === "string" ? body.query : "";
      return NextResponse.json({ ok: true, success: true, assembly: await assembleContentAssets(query) });
    }
    throw new Error("不支持的内容资产操作。");
  } catch (error) {
    return apiError(error, "assets", "内容资产更新失败。", 400);
  }
}
