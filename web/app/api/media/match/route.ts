import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../_utils";
import {
  assignAssetsToProject,
  matchProjectsForAssets,
} from "../../../../../src/services/projectAssetMatcher.js";

export const runtime = "nodejs";

/** POST — 执行素材→项目自动匹配（含批次传播）。
 *  body.action = "auto"（默认）执行自动匹配；
 *  body.action = "assign" 手动整批归属（body.assetIds + body.projectSlug）。 */
export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = typeof body.action === "string" ? body.action : "auto";

    if (action === "assign") {
      const assetIds = Array.isArray(body.assetIds)
        ? body.assetIds.filter((x: unknown): x is string => typeof x === "string")
        : [];
      const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug : "";
      if (assetIds.length === 0 || !projectSlug) {
        return apiError(new Error("缺少 assetIds 或 projectSlug。"), "media", "缺少 assetIds 或 projectSlug。", 400);
      }
      const assets = await assignAssetsToProject(assetIds, projectSlug);
      return NextResponse.json({
        ok: true,
        success: true,
        assets,
        assignedCount: assets.length,
      });
    }

    // 默认自动匹配
    const result = await matchProjectsForAssets();
    return NextResponse.json({
      ok: true,
      success: true,
      results: result.results,
      matchedCount: result.matchedCount,
      candidateCount: result.candidateCount,
      unmatchedCount: result.unmatchedCount,
      assets: result.persistedAssets,
    });
  } catch (error) {
    return apiError(error, "media", "项目匹配失败。", 500);
  }
}
