/** 平台发布内容构建 — 从项目文档提取真正的平台专属文案，不静默伪装
 *
 * 文档来源优先级：
 *   - 06_封面标题与发布文案.md：含「抖音发布文案」「小红书发布文案」等平台专属段落
 *   - 10_发布承接话术.md：承接话术兜底
 *   - 03_口播脚本.md：长文案兜底
 *   - 项目标题/简介：最后兜底
 *
 * 来源标记 source 明确区分：platform_doc / generic_fallback / project_title
 */

import path from "node:path";

import { resolveProjectDirectory } from "./projectManager.js";
import { readProject } from "./projectReader.js";
import type { ProjectDetail } from "./projectReader.js";
import { PLATFORM_PUBLISH_PROFILES, type PublisherPlatform } from "../types/publisher.js";
import type { PublishSessionTarget, TargetContentSource } from "../types/publishSession.js";

interface ProjectFile {
  name: string;
  content: string;
}

/** 平台在 06 文档中的专属段落标题（按优先级） */
const PLATFORM_DOC_SECTIONS: Partial<Record<PublisherPlatform, string[]>> = {
  douyin: ["抖音发布文案", "抖音文案", "抖音"],
  xiaohongshu: ["小红书发布文案", "小红书文案", "小红书"],
  bilibili: ["B站发布文案", "哔哩哔哩发布文案", "B站文案", "B站"],
  tencent: ["视频号发布文案", "微信视频号发布文案", "视频号文案", "视频号"],
  kuaishou: ["快手发布文案", "快手文案", "快手"],
  youtube: ["YouTube发布文案", "YouTube文案", "youtube"],
};

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，\n、\s]+/u)
    .map((t) => t.replace(/^#+/u, "").trim())
    .filter((t) => {
      if (!t) return false;
      // 过滤说明性文字：含 markdown 强调/引号/句号/逗号等不应出现在标签中的标点
      if (/[*"“”‘’。．，,；;:：()（）\[\]【】]/u.test(t)) return false;
      // 标签长度合理上限（中文标签一般 ≤ 12 字）
      if (t.length > 16) return false;
      return true;
    });
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

interface ExtractedDoc {
  title: string;
  /** 各平台专属文案 */
  platformDescriptions: Partial<Record<PublisherPlatform, string>>;
  /** 通用发布文案（06 中的「发布文案」段落，或首个平台文案） */
  genericDescription: string;
  tags: string[];
  /** 06 中记录的封面路径 */
  coverPath?: string;
}

function extractFromDocs(files: ProjectFile[]): ExtractedDoc {
  const doc06 = files.find((f) => /^06_封面标题与发布文案/u.test(f.name));
  const doc10 = files.find((f) => /^10_发布承接话术/u.test(f.name));
  const doc03 = files.find((f) => /^03_口播脚本/u.test(f.name));

  const result: ExtractedDoc = {
    title: "",
    platformDescriptions: {},
    genericDescription: "",
    tags: [],
  };

  if (doc06) {
    result.title =
      firstLine(section(doc06.content, "标题候选")) ||
      firstLine(section(doc06.content, "推荐标题")) ||
      firstLine(section(doc06.content, "标题"));

    // 提取各平台专属文案
    for (const platform of Object.keys(PLATFORM_DOC_SECTIONS) as PublisherPlatform[]) {
      const labels = PLATFORM_DOC_SECTIONS[platform] || [];
      for (const label of labels) {
        const text = section(doc06.content, label);
        if (text) {
          result.platformDescriptions[platform] = text;
          break;
        }
      }
    }

    // 通用发布文案：06 中的「发布文案」段落，或第一个平台文案
    result.genericDescription =
      section(doc06.content, "发布文案") ||
      section(doc06.content, "通用发布文案") ||
      Object.values(result.platformDescriptions)[0] ||
      "";

    const tagBlock = section(doc06.content, "标签建议") || section(doc06.content, "标签");
    const hashtags = tagBlock.match(/#[^\s#,，、]+/gu) || [];
    result.tags = hashtags.length ? splitTags(hashtags.join(", ")) : splitTags(tagBlock);

    const coverLine = section(doc06.content, "封面") || section(doc06.content, "封面路径");
    if (coverLine) result.coverPath = coverLine.split(/\n/u)[0]?.trim() || undefined;
  }

  // 兜底：10 承接话术
  if (!result.genericDescription && doc10) {
    result.genericDescription =
      section(doc10.content, "承接话术") || section(doc10.content, "话术") || firstLine(doc10.content);
  }

  // 兜底：03 口播脚本首段
  if (!result.genericDescription && doc03) {
    result.genericDescription = firstLine(doc03.content);
  }

  return result;
}

/** 解析封面路径为绝对路径（项目目录下） */
function resolveCoverPath(coverPath: string | undefined, projectSlug: string | undefined): string | undefined {
  if (!coverPath) return undefined;
  if (path.isAbsolute(coverPath)) return coverPath;
  if (!projectSlug) return undefined;
  try {
    return path.resolve(resolveProjectDirectory(projectSlug), coverPath);
  } catch {
    return undefined;
  }
}

export interface BuildVariantsInput {
  projectSlug?: string;
  enabledPlatforms: PublisherPlatform[];
}

export interface BuildVariantsResult {
  targets: PublishSessionTarget[];
  projectName: string;
  projectReadOk: boolean;
  missingFields: string[];
  docCoverPath?: string;
}

/** 构建各平台发布目标：抖音/小红书优先读专属文案，其他平台 fallback 并明确标记 */
export async function buildPlatformVariants(input: BuildVariantsInput): Promise<BuildVariantsResult> {
  let detail: ProjectDetail | null = null;
  let projectName = input.projectSlug || "";
  let projectReadOk = false;
  const missingFields: string[] = [];

  if (input.projectSlug) {
    try {
      detail = await readProject(input.projectSlug);
      projectName = detail.name;
      projectReadOk = true;
    } catch {
      projectReadOk = false;
      missingFields.push("项目读取失败");
    }
  }

  const files: ProjectFile[] = detail ? detail.files.map((f) => ({ name: f.name, content: f.content })) : [];
  const extracted = extractFromDocs(files);

  if (!extracted.title) missingFields.push("标题（06 文档）");
  if (!extracted.genericDescription) missingFields.push("发布文案（06/10/03 文档）");
  if (extracted.tags.length === 0) missingFields.push("标签（06 文档）");

  const docCoverPath = resolveCoverPath(extracted.coverPath, input.projectSlug);

  const targets: PublishSessionTarget[] = input.enabledPlatforms.map((platform) => {
    const platformDesc = extracted.platformDescriptions[platform];
    const hasPlatformDoc = Boolean(platformDesc);

    // 抖音/小红书优先用专属文案；其他平台用通用文案
    const description = platformDesc || extracted.genericDescription;

    const source: TargetContentSource = {
      title: extracted.title
        ? hasPlatformDoc
          ? "platform_doc"
          : "project_title_or_doc"
        : "generic_fallback",
      description: description
        ? hasPlatformDoc
          ? "platform_doc"
          : "generic_fallback"
        : "generic_fallback",
      tags: extracted.tags.length > 0 ? "platform_doc" : "generic_fallback",
    };

    return {
      platform,
      title: extracted.title,
      description,
      tags: [...extracted.tags],
      thumbnailPath: docCoverPath,
      status: "pending" as const,
      source,
      adapted: false,
    };
  });

  return { targets, projectName, projectReadOk, missingFields, docCoverPath };
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
