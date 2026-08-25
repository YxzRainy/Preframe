import { NextResponse } from "next/server";
import { apiError } from "../../../../_utils";
import { findPreparation, updatePreparation } from "../../../../../../../src/services/publishPreparationStore.js";
import { checkPreparation } from "../../../../../../../src/services/publishPreparationCheck.js";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const preparation = await findPreparation(id);
    if (!preparation) return apiError(new Error("发布准备任务不存在。"), "publisher", "发布准备任务不存在。", 404);
    const result = await checkPreparation(preparation);
    // 同步状态：blocked/warning → checking → ready/其他由前端控制；这里仅当 ready 时落库
    const nextStatus = result.level === "ready" ? "ready" : "checking";
    const updated = await updatePreparation(id, { status: nextStatus });
    return NextResponse.json({ ok: true, success: true, data: { preparation: updated, check: result } });
  } catch (error) {
    return apiError(error, "publisher", "发布前检查失败。", 500);
  }
}
