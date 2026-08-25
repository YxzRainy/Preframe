import { NextResponse } from "next/server";
import { getProjectCockpit } from "../../../../../../src/services/projectCockpit";
import { apiError } from "../../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ ok: true, success: true, overview: await getProjectCockpit(slug) });
  } catch (error) {
    return apiError(error, "project", "项目概览读取失败。", 400);
  }
}
