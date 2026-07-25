import { NextResponse } from "next/server";
import { refineProjectFile } from "../../../../src/services/contentWorkflow";
import { apiError, readRequestJson } from "../_utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    if (typeof body.projectSlug !== "string" || typeof body.fileName !== "string" || typeof body.feedback !== "string") {
      throw new Error("项目、文件名和修改意见均为必填项。");
    }
    const file = await refineProjectFile(body.projectSlug, body.fileName, body.feedback);
    return NextResponse.json({ ok: true, success: true, file });
  } catch (error) {
    return apiError(error, "refine", "修改失败。", 400);
  }
}
