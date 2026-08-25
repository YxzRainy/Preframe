import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { apiError, readRequestJson } from "../../_utils";
import {
  listSessions,
  createSession,
} from "../../../../../src/services/publishSessionStore.js";
import { readPreferences } from "../../../../../src/services/publisherPreferences.js";
import { buildPlatformVariants } from "../../../../../src/services/platformVariantBuilder.js";
import { findCoverCandidates } from "../../../../../src/services/coverMatcher.js";
import { computeReadiness } from "../../../../../src/services/publishReadiness.js";
import { attachSession, findRecord } from "../../../../../src/services/finalVideoStore.js";
import { updateStage } from "../../../../../src/services/projectStage.js";
import { PUBLISHER_PLATFORMS, type PublisherPlatform } from "../../../../../src/types/publisher.js";
import type { PublishSessionTarget } from "../../../../../src/types/publishSession.js";

export const runtime = "nodejs";

function isPlatformArray(value: unknown): value is PublisherPlatform[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && (PUBLISHER_PLATFORMS as readonly string[]).includes(v));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const sessions = await listSessions();
    return NextResponse.json({ ok: true, success: true, data: { sessions } });
  } catch (error) {
    return apiError(error, "publisher", "发布会话列表读取失败。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    const videoPath = typeof body.videoPath === "string" ? body.videoPath.trim() : "";
    if (!videoPath) return apiError(new Error("缺少 videoPath。"), "publisher", "缺少 videoPath。", 400);
    const projectSlug = typeof body.projectSlug === "string" && body.projectSlug.trim() ? body.projectSlug.trim() : undefined;

    // 启用平台：优先用请求传入，否则读预设
    const prefs = await readPreferences();
    const enabledPlatforms = isPlatformArray(body.enabledPlatforms) && body.enabledPlatforms.length > 0
      ? body.enabledPlatforms
      : prefs.enabledPlatforms;
    if (enabledPlatforms.length === 0) return apiError(new Error("未启用任何平台。"), "publisher", "未启用任何平台。", 400);

    // ── 1. 构建各平台发布内容（从 06/10/03 文档提取，明确标记来源） ──
    const built = await buildPlatformVariants({ projectSlug, enabledPlatforms });
    let targets: PublishSessionTarget[] = built.targets;
    const projectName = built.projectName;
    const missingFields = built.missingFields;

    // ── 2. 自动寻找封面（视频同目录 / 项目目录 / 子目录） ──
    const coverMatch = await findCoverCandidates({ videoPath, projectSlug });
    let selectedCoverPath: string | undefined;

    // 优先：06 文档中明确指定的封面路径且文件存在
    if (built.docCoverPath && await fileExists(built.docCoverPath)) {
      selectedCoverPath = built.docCoverPath;
    }
    // 其次：高置信度自动选中
    if (!selectedCoverPath && coverMatch.autoSelect) {
      selectedCoverPath = coverMatch.autoSelect.path;
    }
    // 写入选定封面到所有 target
    if (selectedCoverPath) {
      targets = targets.map((t) => ({ ...t, thumbnailPath: selectedCoverPath }));
    }

    // ── 3. 文件稳定性（从成片记录读取，未记录时默认稳定） ──
    const record = await findRecord(videoPath).catch(() => null);
    const videoStable = record?.stable !== false;

    // ── 4. 发布就绪度检查（只阻断真正无法继续的情况） ──
    const readiness = await computeReadiness({
      videoPath,
      videoStable,
      targets,
      enabledPlatforms,
      projectMatchClear: Boolean(projectSlug),
    });
    if (readiness.level === "blocked") {
      return apiError(
        new Error(readiness.blockers.join("；")),
        "publisher",
        readiness.blockers.join("；"),
        400,
      );
    }

    // 摘要：从就绪度生成
    const summary =
      readiness.level === "ready"
        ? "资产已就绪"
        : `可继续（${readiness.warnings.length} 项提醒）`;

    // ── 5. 原始内容快照（用于智能适配后撤销） ──
    const originalSnapshot: Record<string, { title: string; description: string; tags: string[] }> = {};
    for (const t of targets) {
      originalSnapshot[t.platform] = { title: t.title, description: t.description, tags: [...t.tags] };
    }

    const session = await createSession({
      videoPath,
      projectSlug,
      projectName,
      targets,
      precheckSummary: summary,
      coverCandidates: coverMatch.candidates,
      readiness,
      originalSnapshot,
    });

    // 项目阶段推进到 ready_to_publish
    if (projectSlug) {
      try {
        await updateStage(projectSlug, "ready_to_publish");
      } catch {
        // 阶段推进失败不阻断会话创建
      }
    }

    // 关联成片记录
    try {
      await attachSession(videoPath, session.id);
    } catch {
      // 忽略
    }

    return NextResponse.json({
      ok: true,
      success: true,
      data: {
        session,
        readiness,
        missingFields,
        coverAutoSelected: Boolean(selectedCoverPath),
      },
    }, { status: 201 });
  } catch (error) {
    return apiError(error, "publisher", "发布会话创建失败。", 400);
  }
}
