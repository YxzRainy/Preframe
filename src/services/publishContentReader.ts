/** 发布内容读取 — 从项目 06/10 文档提取各平台发布文案，生成发布会话草稿
 * 不调用模型、不调用平台、不要求登录。 */

import path from "node:path";

import { readProject } from "./projectReader.js";
import { readStage } from "./projectStage.js";
import { PLATFORM_PUBLISH_PROFILES, type PublisherPlatform } from "../types/publisher.js";
import type { PublishSessionTarget } from "../types/publishSession.js";

interface ProjectFile {
  name: string;
  content: string;
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，\n、\s]+/u)
    .map((t) => t.replace(/^#+/u, "").trim())
    .filter(Boolean);
}

function section(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)#{1,6}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, "iu");
  return pattern.exec(content)?.[1]?.trim() ?? "";
}

function firstLine(text: string): string {
  const line = text.split(/\n/u).find((l) => l.trim());
  if (!line) return "";
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").replace(/^#+\s*/u, "").trim();
}

interface ExtractedContent {
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
  missingFields: string[];
}

/** 从 06/10 文档保守提取标题/文案/标签；缺失字段记录但不阻断 */
function extractProjectContent(files: ProjectFile[]): ExtractedContent {
  const doc06 = files.find((f) => /^06_封面标题与发布文案/u.test(f.name));
  const doc10 = files.find((f) => /^10_发布承接话术/u.test(f.name));
  let title = "";
  let description = "";
  let tags: string[] = [];
  let thumbnailPath: string | undefined;
  const missingFields: string[] = [];

  if (doc06) {
    title = firstLine(section(doc06.content, "标题候选")) || firstLine(section(doc06.content, "推荐标题")) || firstLine(section(doc06.content, "标题"));
    description = section(doc06.content, "抖音发布文案") || section(doc06.content, "小红书发布文案") || section(doc06.content, "发布文案");
    const tagBlock = section(doc06.content, "标签建议") || section(doc06.content, "标签");
    const hashtags = tagBlock.match(/#[^\s#,，、]+/gu) || [];
    tags = hashtags.length ? splitTags(hashtags.join(", ")) : splitTags(tagBlock);
    const coverLine = section(doc06.content, "封面") || section(doc06.content, "封面路径");
    if (coverLine) thumbnailPath = coverLine.split(/\n/u)[0]?.trim() || undefined;
  }

  if (!description && doc10) {
    description = section(doc10.content, "承接话术") || section(doc10.content, "话术") || firstLine(doc10.content);
  }

  if (!title) missingFields.push("标题（06 文档）");
  if (!description) missingFields.push("描述/文案（06/10 文档）");
  if (tags.length === 0) missingFields.push("标签（06 文档）");

  return { title, description, tags, thumbnailPath, missingFields };
}

export interface BuildTargetsInput {
  projectSlug: string;
  enabledPlatforms: PublisherPlatform[];
}

export interface BuildTargetsResult {
  targets: PublishSessionTarget[];
  projectName: string;
  missingFields: string[];
  projectReadOk: boolean;
  stage?: string;
}

/** 读取项目发布内容并按启用平台生成会话目标 */
export async function buildSessionTargets(input: BuildTargetsInput): Promise<BuildTargetsResult> {
  let files: ProjectFile[] = [];
  let projectName = input.projectSlug;
  let projectReadOk = false;
  let stage: string | undefined;
  const missingFields: string[] = [];

  try {
    const detail = await readProject(input.projectSlug);
    files = detail.files.map((f) => ({ name: f.name, content: f.content }));
    projectName = detail.name;
    projectReadOk = true;
    try {
      const stageCtx = await readStage(input.projectSlug);
      stage = stageCtx.stage;
    } catch {
      // 阶段读取失败不阻断
    }
  } catch {
    projectReadOk = false;
    missingFields.push("项目读取失败");
  }

  const extracted = extractProjectContent(files);
  missingFields.push(...extracted.missingFields);

  // 尝试解析封面为绝对路径（项目目录下）
  let coverPath = extracted.thumbnailPath;
  if (coverPath && !path.isAbsolute(coverPath)) {
    // 相对路径无法可靠解析时保留原值，预检会校验
  }

  const targets: PublishSessionTarget[] = input.enabledPlatforms.map((platform) => ({
    platform,
    title: extracted.title,
    description: extracted.description,
    tags: [...extracted.tags],
    thumbnailPath: coverPath,
    status: "pending" as const,
  }));

  return { targets, projectName, missingFields, projectReadOk, stage };
}

/** 生成某平台的剪贴板文案（标题 + 描述 + #标签） */
export function buildClipboardText(target: PublishSessionTarget): string {
  const lines: string[] = [];
  if (target.title.trim()) lines.push(target.title.trim());
  if (target.description.trim()) lines.push("", target.description.trim());
  if (target.tags.length > 0) {
    lines.push("", target.tags.map((t) => `#${t.replace(/^#+/, "")}`).join(" "));
  }
  return lines.join("\n").trim();
}

/** 复用配置：检查平台后台 URL 是否配置 */
export function isBackendUrlConfigured(platform: PublisherPlatform): boolean {
  return Boolean(PLATFORM_PUBLISH_PROFILES[platform]?.creatorBackendUrl);
}
