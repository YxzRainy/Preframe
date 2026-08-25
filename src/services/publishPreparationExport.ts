/** 发布包导出 — 把发布准备任务导出为本地目录（Markdown + manifest.json）
 * 不调用平台、不调用登录、不调用 Cookie。 */

import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PLATFORM_PUBLISH_PROFILES, PUBLISHER_PLATFORM_LABELS, type PublishPreparation, type PublisherPlatform } from "../types/publisher.js";

export interface ExportPreparationInput {
  preparation: PublishPreparation;
  outputDir: string;
  /** 是否同时复制视频文件到 video/ 目录；默认 false（只保存绝对路径引用） */
  copyVideo?: boolean;
}

export interface ExportPreparationResult {
  exportDir: string;
  files: string[];
  copiedVideo: boolean;
  manifestPath: string;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名";
}

function buildPlatformMarkdown(platform: PublisherPlatform, prep: PublishPreparation, target: PublishPreparation["targets"][number]): string {
  const label = PUBLISHER_PLATFORM_LABELS[platform];
  const profile = PLATFORM_PUBLISH_PROFILES[platform];
  const lines: string[] = [
    `# ${label} 发布内容`,
    "",
    `> 平台：${label}（${platform}）`,
    `> 自动发布状态：${profile.autoPublishStatus === "verified" ? "已验证" : profile.autoPublishStatus === "experimental" ? "实验性（未完成端到端验证）" : "未验证"}`,
    `> 创建时间：${prep.createdAt}`,
    `> 导出时间：${new Date().toISOString()}`,
    "",
    "## 标题",
    "",
    target.title.trim() || "（空）",
    "",
    "## 描述",
    "",
    target.description.trim() || "（空）",
    "",
    "## 标签",
    "",
    target.tags.length > 0 ? target.tags.join(", ") : "（无）",
    "",
    "## 封面路径",
    "",
    target.thumbnailPath?.trim() || "（未设置）",
    "",
    "## 视频路径",
    "",
    prep.videoPath,
    "",
  ];
  if (profile.creatorBackendUrl) {
    lines.push("## 官方创作者后台", "", profile.creatorBackendUrl, "");
  }
  if (target.manuallyPublished) {
    lines.push("## 手动发布标记", "", `已手动标记为已发布（${target.manuallyPublishedAt || ""}）`, "");
  }
  if (target.publishResult) {
    lines.push("## 发布结果", "", target.publishResult === "published" ? "已发布" : "发布失败", "");
  }
  if (target.publishUrl) lines.push("## 发布链接", "", target.publishUrl, "");
  if (target.publishNote) lines.push("## 结果备注", "", target.publishNote, "");
  return lines.join("\n");
}

export async function exportPreparation(input: ExportPreparationInput): Promise<ExportPreparationResult> {
  const { preparation, outputDir } = input;
  const copyVideo = input.copyVideo === true;
  if (!outputDir.trim()) throw new Error("导出目录不能为空。");
  if (!preparation.videoPath.trim()) throw new Error("发布准备缺少视频路径。");

  const projectPart = preparation.projectSlug ? safeFileName(preparation.projectSlug) : "preframe";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dirName = `${projectPart}_发布包_${stamp}`;
  const exportDir = path.join(outputDir, dirName);

  await mkdir(exportDir, { recursive: true });
  const files: string[] = [];

  // video/
  const videoDir = path.join(exportDir, "video");
  await mkdir(videoDir, { recursive: true });
  let copiedVideo = false;
  let videoRef = preparation.videoPath;
  if (copyVideo) {
    try {
      const s = await stat(preparation.videoPath);
      if (s.isFile()) {
        const dest = path.join(videoDir, path.basename(preparation.videoPath));
        await copyFile(preparation.videoPath, dest);
        files.push(dest);
        copiedVideo = true;
        videoRef = path.relative(exportDir, dest);
      }
    } catch {
      // 视频不可访问时只保存引用
    }
  }
  const videoRefPath = path.join(videoDir, "视频路径说明.txt");
  await writeFile(videoRefPath, `视频绝对路径：${preparation.videoPath}\n是否已复制：${copiedVideo ? "是" : "否（仅保存路径引用，未复制文件）"}\n`, "utf8");
  files.push(videoRefPath);

  // covers/
  const coversDir = path.join(exportDir, "covers");
  await mkdir(coversDir, { recursive: true });
  const coverRefs: Record<string, string> = {};
  for (const t of preparation.targets) {
    if (!t.thumbnailPath?.trim()) continue;
    try {
      const s = await stat(t.thumbnailPath);
      if (s.isFile()) {
        const ext = path.extname(t.thumbnailPath) || ".jpg";
        const dest = path.join(coversDir, `${t.platform}${ext}`);
        await copyFile(t.thumbnailPath, dest);
        files.push(dest);
        coverRefs[t.platform] = path.relative(exportDir, dest);
        continue;
      }
    } catch {
      /* ignore */
    }
    coverRefs[t.platform] = t.thumbnailPath;
  }

  // 各平台 Markdown
  for (const t of preparation.targets) {
    if (!t.enabled) continue;
    const md = buildPlatformMarkdown(t.platform, preparation, t);
    const mdPath = path.join(exportDir, `${t.platform}.md`);
    await writeFile(mdPath, md, "utf8");
    files.push(mdPath);
  }

  // manifest.json
  const manifest = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    preparationId: preparation.id,
    projectSlug: preparation.projectSlug || null,
    status: preparation.status,
    video: {
      absolutePath: preparation.videoPath,
      copied: copiedVideo,
      refPath: copiedVideo ? videoRef : preparation.videoPath,
    },
    masterContent: preparation.masterContent,
    targets: preparation.targets
      .filter((t) => t.enabled)
      .map((t) => ({
        platform: t.platform,
        label: PUBLISHER_PLATFORM_LABELS[t.platform],
        title: t.title,
        description: t.description,
        tags: t.tags,
        thumbnailPath: t.thumbnailPath || null,
        thumbnailRef: coverRefs[t.platform] || null,
        manuallyPublished: Boolean(t.manuallyPublished),
        manuallyPublishedAt: t.manuallyPublishedAt || null,
        publishResult: t.publishResult || null,
        publishUrl: t.publishUrl || null,
        publishNote: t.publishNote || null,
        creatorBackendUrl: PLATFORM_PUBLISH_PROFILES[t.platform].creatorBackendUrl || null,
      })),
  };
  const manifestPath = path.join(exportDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  files.push(manifestPath);

  return { exportDir, files, copiedVideo, manifestPath };
}
