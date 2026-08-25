import { NextResponse } from "next/server";
import { exportProjectArchive } from "../../../../../../src/services/projectArchive";
import { apiError } from "../../../_utils";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const archive = await exportProjectArchive(slug);
    const filename = `${archive.sourceSlug}.preframe-project.json`;
    return new NextResponse(`${JSON.stringify(archive, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return apiError(error, "project", "项目导出失败。", 400);
  }
}
