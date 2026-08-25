import { NextResponse } from "next/server";
import { apiError } from "../../../../../_utils";
import {
  readEditingManifest,
  detectMissingSources,
  detectProjectFiles,
  summarizeManifest,
  groupVideoEntries,
} from "../../../../../../../../src/services/editingPrepBuilder.js";
import { getProxyStatusForProject, refreshProxyStatus } from "../../../../../../../../src/services/proxyManager.js";

export const runtime = "nodejs";

/** GET — 读取剪辑工作区状态：manifest + 概况 + 失效素材 + 工程文件 + proxy 状态 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    // 先刷新 proxy stale 状态
    await refreshProxyStatus(slug);

    const [manifest, missing, projectFiles, proxyViews] = await Promise.all([
      readEditingManifest(slug),
      detectMissingSources(slug),
      detectProjectFiles(slug),
      getProxyStatusForProject(slug),
    ]);

    const summary = summarizeManifest(manifest);
    const groups = groupVideoEntries(manifest);

    return NextResponse.json({
      ok: true,
      success: true,
      manifest,
      summary: { ...summary, missingSource: missing.missing.length },
      missing: missing.missing,
      projectFiles,
      proxyViews,
      groups: {
        byShot: Array.from(groups.byShot.entries()).map(([k, v]) => ({ key: k, count: v.length, entries: v })),
        byOrientation: Array.from(groups.byOrientation.entries()).map(([k, v]) => ({ key: k, count: v.length })),
        bySourceDir: Array.from(groups.bySourceDir.entries()).map(([k, v]) => ({ key: k, count: v.length })),
      },
    });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "media", "剪辑工作区状态读取失败。", status);
  }
}
