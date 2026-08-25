import { NextResponse } from "next/server";
import { readStage, updateStage, type ProjectStage } from "../../../../../../src/services/projectStage";
import { readRequestJson, apiError } from "../../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ ok: true, success: true, stage: await readStage(slug) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "stage", "项目阶段读取失败。", status);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request);
    if (typeof body.stage !== "string") throw new Error("缺少 stage 字段。");
    const stage = body.stage as ProjectStage;
    const nextAction = typeof body.nextAction === "string" ? body.nextAction : undefined;
    const result = await updateStage(slug, stage, nextAction);
    return NextResponse.json({ ok: true, success: true, stage: result });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "stage", "项目阶段更新失败。", status);
  }
}
