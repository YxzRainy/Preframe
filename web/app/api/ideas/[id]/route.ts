import { NextResponse } from "next/server";
import { deleteIdea, updateIdea } from "../../../../../src/services/ideaManager";
import { readRequestJson, apiError } from "../../_utils";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readRequestJson(request);
    const patch: Parameters<typeof updateIdea>[1] = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.note === "string") patch.note = body.note;
    if (typeof body.source === "string") patch.source = body.source;
    if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t): t is string => typeof t === "string");
    if (typeof body.convertedProjectSlug === "string") patch.convertedProjectSlug = body.convertedProjectSlug;
    const idea = await updateIdea(id, patch);
    return NextResponse.json({ ok: true, success: true, idea });
  } catch (error) {
    return apiError(error, "idea", "灵感更新失败。", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteIdea(id);
    return NextResponse.json({ ok: true, success: true });
  } catch (error) {
    return apiError(error, "idea", "灵感删除失败。", 400);
  }
}
