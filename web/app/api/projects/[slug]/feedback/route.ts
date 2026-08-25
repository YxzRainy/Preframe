import { NextResponse } from "next/server";
import { listShootingFeedback, saveShootingFeedback } from "../../../../../../src/services/shootingFeedback";
import type { ShootingFeedbackInput } from "../../../../../../src/types/shootingFeedback";
import { apiError, readRequestJson } from "../../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ ok: true, success: true, feedback: await listShootingFeedback(slug) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "feedback", "拍摄复盘读取失败。", status);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    const feedback = await saveShootingFeedback(slug, body as ShootingFeedbackInput);
    return NextResponse.json({ ok: true, success: true, feedback });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "feedback", "拍摄复盘保存失败。", status);
  }
}
