import { NextResponse } from "next/server";
import { scanProjectAssets } from "../../../../src/services/contentWorkflow";
import { apiError, readRequestJson } from "../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    if (typeof body.projectSlug !== "string" || typeof body.assetPath !== "string") {
      throw new Error("项目和素材文件夹路径均为必填项。");
    }
    return NextResponse.json({ ok: true, success: true, file: await scanProjectAssets(body.projectSlug, body.assetPath) });
  } catch (error) {
    return apiError(error, "scan", "素材扫描失败。", 400);
  }
}
