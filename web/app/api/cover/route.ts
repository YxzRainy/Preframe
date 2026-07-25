import { NextResponse } from "next/server";
import { generateProjectCover } from "../../../../src/services/contentWorkflow";
import { COVER_RATIOS, type CoverRatio } from "../../../../src/services/imageClient";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    success: true,
    configured: Boolean(process.env.IMAGE_API_KEY && process.env.IMAGE_API_URL && process.env.IMAGE_MODEL),
    model: process.env.IMAGE_MODEL || null,
    ratios: Object.entries(COVER_RATIOS).map(([value, config]) => ({ value, ...config })),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.projectSlug !== "string" || typeof body.prompt !== "string" || typeof body.ratio !== "string") {
      throw new Error("项目、提示词和封面比例均为必填项。");
    }
    if (!(body.ratio in COVER_RATIOS)) throw new Error("不支持的封面比例。");
    const cover = await generateProjectCover(body.projectSlug, body.prompt, body.ratio as CoverRatio);
    const url = `/api/projects/${encodeURIComponent(body.projectSlug)}/covers/${encodeURIComponent(cover.name)}`;
    return NextResponse.json({ success: true, cover: { ...cover, url } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "封面生成失败。" }, { status: 400 });
  }
}
