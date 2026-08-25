import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "../../../../_utils";
import { findSession, applyAdaptedVariants, revertAdaptedVariants } from "../../../../../../../src/services/publishSessionStore.js";
import { adaptPlatformVariants, ADAPTED_SOURCE } from "../../../../../../../src/services/platformAdapter.js";
import { getAccountMemory, sanitizeAccountMemoryForPrompt } from "../../../../../../../src/services/accountMemory.js";
import { readProject } from "../../../../../../../src/services/projectReader.js";
import { PUBLISHER_PLATFORMS, type PublisherPlatform } from "../../../../../../../src/types/publisher.js";

export const runtime = "nodejs";
// 智能适配是一次性模型调用，可能较慢
export const maxDuration = 120;

function isPlatformArray(value: unknown): value is PublisherPlatform[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(v));
}

/** 从项目文档中提取主题摘要（首段非空文本） */
async function readProjectTopic(projectSlug: string | undefined): Promise<string> {
  if (!projectSlug) return "";
  try {
    const detail = await readProject(projectSlug);
    const doc03 = detail.files.find((f) => /^03_口播脚本/u.test(f.name));
    if (doc03) {
      const firstPara = doc03.content.split(/\n\s*\n/u).find((p) => p.trim());
      if (firstPara) return firstPara.replace(/^#+\s*/u, "").trim().slice(0, 120);
    }
    return detail.name;
  } catch {
    return "";
  }
}

/** 用户主动点击「优化各平台版本」：一次模型调用适配所有平台，失败保留原版本 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);

    const body = await readRequestJson(request).catch((): Record<string, unknown> => ({}));
    // 可指定只适配部分平台，默认全部
    const platforms = isPlatformArray(body.platforms) && body.platforms.length > 0
      ? body.platforms
      : session.targets.map((t) => t.platform);
    if (platforms.length === 0) return apiError(new Error("未指定任何平台。"), "publisher", "未指定任何平台。", 400);

    // 创作偏好（如存在）
    let creationPreferences = "";
    try {
      const memory = await getAccountMemory();
      creationPreferences = sanitizeAccountMemoryForPrompt(memory);
    } catch {
      // 读取失败不阻断
    }

    const projectTopic = await readProjectTopic(session.projectSlug);

    const result = await adaptPlatformVariants({
      platforms,
      targets: session.targets,
      projectName: session.projectName,
      projectTopic,
      creationPreferences,
    });

    if (!result.ok) {
      // 失败保留原版本，返回错误信息但不修改会话
      return NextResponse.json({
        ok: false,
        success: false,
        error: result.error || "智能适配失败，已保留原版本",
        data: { session },
      }, { status: 200 });
    }

    const updated = await applyAdaptedVariants(id, result.variants, ADAPTED_SOURCE);
    return NextResponse.json({
      ok: true,
      success: true,
      data: { session: updated, adaptedPlatforms: Object.keys(result.variants) },
    });
  } catch (error) {
    return apiError(error, "publisher", "智能适配失败。", 500);
  }
}

/** 撤销智能适配：从原始快照恢复 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await findSession(id);
    if (!session) return apiError(new Error("发布会话不存在。"), "publisher", "发布会话不存在。", 404);
    const updated = await revertAdaptedVariants(id);
    return NextResponse.json({ ok: true, success: true, data: { session: updated } });
  } catch (error) {
    return apiError(error, "publisher", "撤销适配失败。", 500);
  }
}
