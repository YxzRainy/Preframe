import { NextResponse } from "next/server";
import { refineProjectFile } from "../../../../src/services/contentWorkflow";
import { apiError, assertSameOrigin, readRequestJson } from "../_utils";
import { runWithWebModelAccess } from "../../../lib/model-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readRequestJson(request);
    if (typeof body.projectSlug !== "string" || typeof body.fileName !== "string" || typeof body.feedback !== "string") {
      throw new Error("项目、文件名和修改意见均为必填项。");
    }
    const projectSlug = body.projectSlug;
    const fileName = body.fileName;
    const feedback = body.feedback;
    const file = await runWithWebModelAccess(request, () => refineProjectFile(projectSlug, fileName, feedback));
    return NextResponse.json({ ok: true, success: true, file });
  } catch (error) {
    return apiError(error, "refine", "修改失败。", 400);
  }
}
