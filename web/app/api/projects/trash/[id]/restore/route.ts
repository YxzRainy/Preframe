import { NextResponse } from "next/server";
import { restoreProjectFromTrash } from "../../../../../../../src/services/projectManager";
import { apiError } from "../../../../_utils";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ ok: true, success: true, restored: await restoreProjectFromTrash(id) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "项目恢复失败。", status);
  }
}
