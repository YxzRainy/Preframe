import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../_utils";
import { deleteAccount, updateAccount } from "../../../../../../src/services/publisherAccountStore.js";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const input: { displayName?: string; enabled?: boolean } = {};
    if (typeof body.displayName === "string") input.displayName = body.displayName;
    if (typeof body.enabled === "boolean") input.enabled = body.enabled;
    const account = await updateAccount(id, input);
    return NextResponse.json({ ok: true, success: true, data: { account } });
  } catch (error) {
    return apiError(error, "publisher", "账号更新失败。", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteAccount(id);
    return NextResponse.json({ ok: true, success: true, data: { deleted: true } });
  } catch (error) {
    return apiError(error, "publisher", "账号删除失败。", 400);
  }
}
