import { NextResponse } from "next/server";
import { inspectDataMigration, runDataMigration } from "../../../../../src/services/dataMigration";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, success: true, report: await inspectDataMigration() });
  } catch (error) {
    return apiError(error, "project", "数据版本检查失败。", 500);
  }
}

export async function POST() {
  try {
    return NextResponse.json({ ok: true, success: true, report: await runDataMigration() });
  } catch (error) {
    return apiError(error, "project", "数据迁移失败。", 500);
  }
}
