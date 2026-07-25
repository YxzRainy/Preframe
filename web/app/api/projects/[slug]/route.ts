import { NextResponse } from "next/server";
import { moveProjectToTrash } from "../../../../../src/services/projectManager";
import { readProject } from "../../../../../src/services/projectReader";
import { apiError } from "../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ ok: true, success: true, project: await readProject(slug) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "项目读取失败。", status);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    await moveProjectToTrash(slug);
    return NextResponse.json({ ok: true, success: true });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "project", "项目删除失败。", status);
  }
}
