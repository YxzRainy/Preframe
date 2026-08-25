import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { resolveProjectDirectory } from "../../../../../../../src/services/projectManager.js";
import { readMediaAssets } from "../../../../../../../src/services/mediaAssetStore.js";
import {
  batchConfirmLinks,
  confirmLink,
  getLinksForProject,
  manualLink,
  rejectLink,
  reassignLink,
} from "../../../../../../../src/services/shotAssetLinkStore.js";
import { matchShotsForProject } from "../../../../../../../src/services/shotAssetMatcher.js";
import type { MediaAsset, ShotAssetLink } from "../../../../../../../src/types/mediaAsset.js";

export const runtime = "nodejs";

interface LinkWithAsset extends ShotAssetLink {
  asset?: MediaAsset;
}

async function enrichLinks(links: ShotAssetLink[]): Promise<LinkWithAsset[]> {
  const assets = await readMediaAssets();
  const byId = new Map(assets.map((a) => [a.id, a]));
  return links.map((l) => ({ ...l, asset: byId.get(l.assetId) }));
}

/** GET — 读取项目的镜头-素材关系（含素材信息）
 *  ?scan=1 同时触发镜头匹配刷新 suggested 关系 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const shouldMatch = url.searchParams.get("scan") === "1";

    if (shouldMatch) {
      const matchResult = await matchShotsForProject(slug);
      return NextResponse.json({
        ok: true,
        success: true,
        links: await enrichLinks(matchResult.suggestedLinks),
        matchResults: matchResult.results,
        batchSuggestions: matchResult.batchSuggestions,
        shotTaskCount: matchResult.shotTaskCount,
        assetCount: matchResult.assetCount,
      });
    }

    const links = await getLinksForProject(slug);
    return NextResponse.json({ ok: true, success: true, links: await enrichLinks(links) });
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "media", "镜头素材关系读取失败。", status);
  }
}

/** POST — 关系操作：confirm / batch-confirm / reject / reassign / manual-link / match */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    // 校验项目存在
    resolveProjectDirectory(slug);
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const action = typeof body.action === "string" ? body.action : "match";

    if (action === "match") {
      const result = await matchShotsForProject(slug);
      return NextResponse.json({
        ok: true,
        success: true,
        links: await enrichLinks(result.suggestedLinks),
        matchResults: result.results,
        batchSuggestions: result.batchSuggestions,
        shotTaskCount: result.shotTaskCount,
        assetCount: result.assetCount,
      });
    }
    if (action === "confirm") {
      const linkId = typeof body.linkId === "string" ? body.linkId : "";
      if (!linkId) return apiError(new Error("缺少 linkId。"), "media", "缺少 linkId。", 400);
      const primary = body.primary !== false;
      const links = await confirmLink(linkId, primary);
      return NextResponse.json({ ok: true, success: true, links: await enrichLinks(links.filter((l) => l.projectSlug === slug)) });
    }
    if (action === "batch-confirm") {
      const linkIds = Array.isArray(body.linkIds)
        ? body.linkIds.filter((x: unknown): x is string => typeof x === "string")
        : [];
      if (linkIds.length === 0) return apiError(new Error("缺少 linkIds。"), "media", "缺少 linkIds。", 400);
      const links = await batchConfirmLinks(linkIds);
      return NextResponse.json({ ok: true, success: true, links: await enrichLinks(links.filter((l) => l.projectSlug === slug)), confirmedCount: linkIds.length });
    }
    if (action === "reject") {
      const linkId = typeof body.linkId === "string" ? body.linkId : "";
      if (!linkId) return apiError(new Error("缺少 linkId。"), "media", "缺少 linkId。", 400);
      const links = await rejectLink(linkId);
      return NextResponse.json({ ok: true, success: true, links: await enrichLinks(links.filter((l) => l.projectSlug === slug)) });
    }
    if (action === "reassign") {
      const linkId = typeof body.linkId === "string" ? body.linkId : "";
      const newShotTaskId = typeof body.shotTaskId === "string" ? body.shotTaskId : "";
      if (!linkId || !newShotTaskId) return apiError(new Error("缺少 linkId 或 shotTaskId。"), "media", "缺少 linkId 或 shotTaskId。", 400);
      const links = await reassignLink(linkId, newShotTaskId);
      return NextResponse.json({ ok: true, success: true, links: await enrichLinks(links.filter((l) => l.projectSlug === slug)) });
    }
    if (action === "manual-link") {
      const shotTaskId = typeof body.shotTaskId === "string" ? body.shotTaskId : "";
      const assetId = typeof body.assetId === "string" ? body.assetId : "";
      if (!shotTaskId || !assetId) return apiError(new Error("缺少 shotTaskId 或 assetId。"), "media", "缺少 shotTaskId 或 assetId。", 400);
      await manualLink(slug, shotTaskId, assetId);
      const links = await getLinksForProject(slug);
      return NextResponse.json({ ok: true, success: true, links: await enrichLinks(links) });
    }

    return apiError(new Error(`未知操作：${action}`), "media", `未知操作：${action}`, 400);
  } catch (error) {
    const status = error instanceof Error && error.name === "ProjectNotFoundError" ? 404 : 400;
    return apiError(error, "media", "镜头素材关系操作失败。", status);
  }
}
