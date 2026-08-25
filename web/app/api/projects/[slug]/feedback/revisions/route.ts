import { NextResponse } from "next/server";
import { listFeedbackRevisions } from "../../../../../../../src/services/shootingFeedback";
import { apiError } from "../../../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ ok: true, success: true, revisions: await listFeedbackRevisions(slug) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "feedback", "修订版本读取失败。", status);
  }
}
