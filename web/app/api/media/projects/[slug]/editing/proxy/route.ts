import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../../_utils";
import {
  enqueueProxyGeneration,
  batchEnqueueProxy,
  getProxyStatusForProject,
  PROXY_PRESETS,
  DEFAULT_PRESET,
  type BatchScope,
} from "../../../../../../../../src/services/proxyManager.js";
import type { ProxyPreset } from "../../../../../../../../src/types/editingManifest.js";

export const runtime = "nodejs";

function isPreset(v: unknown): v is ProxyPreset {
  return v === "fast" || v === "high";
}
function isScope(v: unknown): v is BatchScope {
  return v === "recommended" || v === "all" || v === "shots";
}

/** GET — 获取项目 proxy 状态视图（带进度） */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const views = await getProxyStatusForProject(slug);
    return NextResponse.json({ ok: true, success: true, views, presets: PROXY_PRESETS, defaultPreset: DEFAULT_PRESET });
  } catch (error) {
    return apiError(error, "media", "Proxy 状态读取失败。", 400);
  }
}

/** POST — 入队 proxy 生成
 * body.batch=true 时按 scope 批量；否则按 assetId 单个 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    const preset = isPreset(body.preset) ? body.preset : DEFAULT_PRESET;

    if (body.batch === true) {
      const scope = isScope(body.scope) ? body.scope : "recommended";
      const result = await batchEnqueueProxy(slug, scope, preset);
      return NextResponse.json({ ok: true, success: true, ...result });
    }

    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    if (!assetId) return apiError(new Error("缺少 assetId。"), "media", "缺少 assetId。", 400);
    const force = body.force === true;
    const result = await enqueueProxyGeneration(slug, assetId, preset, force);
    return NextResponse.json({ ok: true, success: true, ...result });
  } catch (error) {
    return apiError(error, "media", "Proxy 入队失败。", 400);
  }
}
