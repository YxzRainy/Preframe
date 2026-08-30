import { NextResponse } from "next/server";
import { searchWorkspaceDocuments } from "../../../../src/services/workspaceSearch";
import { apiError } from "../_utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q") || "";
    if (query.trim().length > 120) throw new Error("搜索词不能超过 120 个字符。");
    return NextResponse.json({ ok: true, success: true, results: await searchWorkspaceDocuments(query) });
  } catch (error) {
    return apiError(error, "project", "全文搜索失败。", 400);
  }
}
