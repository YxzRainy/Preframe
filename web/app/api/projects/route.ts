import { NextResponse } from "next/server";
import { readProjects } from "../../../../src/services/projectReader";
import { apiError } from "../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, projects: await readProjects() });
  } catch (error) {
    return apiError(error, "project", "项目读取失败。", 500);
  }
}
