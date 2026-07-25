import { NextResponse } from "next/server";
import { getTrialStatus } from "../../../../lib/supabase/trial";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getTrialStatus();
    return NextResponse.json({ ok: true, success: true, status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      success: false,
      error: error instanceof Error ? error.message : "登录状态读取失败。",
    }, { status: 500 });
  }
}
