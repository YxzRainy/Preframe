import { NextResponse } from "next/server";
import { listTrashProjects } from "../../../../../src/services/projectManager";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, projects: await listTrashProjects() });
  } catch (error) {
    return apiError(error, "project", "回收站读取失败。", 500);
  }
}
