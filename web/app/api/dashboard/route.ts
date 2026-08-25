import { NextResponse } from "next/server";
import { loadDashboardData } from "../../../lib/dashboardData";
import { apiError } from "../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, ...(await loadDashboardData()) });
  } catch (error) {
    return apiError(error, "read", "工作台数据读取失败。", 500);
  }
}
