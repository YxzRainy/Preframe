/** 平台智能适配 — 用户主动点击「优化各平台版本」才调用模型
 *
 * 设计要点：
 *   - 单次模型调用返回所有目标平台 JSON（不每平台单独调用）
 *   - JSON schema 校验；失败保留原版本
 *   - 用户可撤销回原版本
 *   - 不生成长篇解释
 *   - 不在成片出现时自动消耗 API
 */

import { callModel } from "./modelClient.js";
import { PUBLISHER_PLATFORM_LABELS, type PublisherPlatform } from "../types/publisher.js";
import type { PublishSessionTarget, TargetContentSource } from "../types/publishSession.js";

export interface AdaptedPlatformContent {
  title: string;
  description: string;
  tags: string[];
}

export type AdaptedVariants = Partial<Record<PublisherPlatform, AdaptedPlatformContent>>;

export interface AdaptInput {
  platforms: PublisherPlatform[];
  targets: PublishSessionTarget[];
  projectTopic?: string;
  projectName?: string;
  /** 创作偏好（如存在） */
  creationPreferences?: string;
  signal?: AbortSignal;
}

export interface AdaptResult {
  ok: boolean;
  variants: AdaptedVariants;
  /** 失败原因（失败时保留原版本） */
  error?: string;
}

const ADAPTED_SOURCE: TargetContentSource = {
  title: "ai_adapted",
  description: "ai_adapted",
  tags: "ai_adapted",
};

function buildPrompt(input: AdaptInput): string {
  const platformList = input.platforms
    .map((p) => `${p}（${PUBLISHER_PLATFORM_LABELS[p]}）`)
    .join("、");

  const variantsDesc = input.platforms
    .map((p) => {
      const t = input.targets.find((x) => x.platform === p);
      return `【${p}】\n标题：${t?.title || "（空）"}\n文案：${t?.description || "（空）"}\n标签：${(t?.tags || []).join("、") || "（无）"}`;
    })
    .join("\n\n");

  return `你是一位资深短视频多平台运营。根据以下原始内容，为每个平台生成更适合该平台的发布版本。

# 项目信息
项目名：${input.projectName || "未提供"}
主题：${input.projectTopic || "未提供"}
${input.creationPreferences ? `创作偏好：${input.creationPreferences}` : ""}

# 原始内容（各平台当前版本）
${variantsDesc}

# 目标平台
${platformList}

# 各平台调性参考
- douyin：标题抓眼球、文案口语化、标签 3-5 个热门词
- xiaohongshu：标题带情绪/数字、文案分段加 emoji、标签 5-8 个
- bilibili：标题信息量足、文案偏正式、标签含分区
- tencent：标题简洁、文案稳重
- kuaishou：标题接地气、文案直接
- youtube：标题中英兼顾、文案偏正式

# 输出要求
只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
结构：每个平台一个 key，值为 { "title": string, "description": string, "tags": string[] }。
title ≤ 30 字，description ≤ 200 字，tags 3-8 个（不带 #）。
示例：
{"douyin":{"title":"...","description":"...","tags":["...","..."]},"xiaohongshu":{...}}

现在输出 JSON：`;
}

/** 从模型返回中提取 JSON 对象（兼容裸 JSON 与代码块） */
function extractJson(raw: string): unknown {
  let text = raw.trim();
  // 去除 markdown 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("模型未返回有效 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function isValidContent(value: unknown): value is AdaptedPlatformContent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.description === "string" &&
    Array.isArray(v.tags) &&
    v.tags.every((t) => typeof t === "string")
  );
}

/** 一次模型调用适配所有平台 */
export async function adaptPlatformVariants(input: AdaptInput): Promise<AdaptResult> {
  if (input.platforms.length === 0) {
    return { ok: false, variants: {}, error: "未指定任何平台" };
  }

  let raw: string;
  try {
    raw = await callModel(buildPrompt(input), { signal: input.signal });
  } catch (err) {
    return {
      ok: false,
      variants: {},
      error: err instanceof Error ? err.message : "模型调用失败",
    };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    return { ok: false, variants: {}, error: "模型返回不是有效 JSON，已保留原版本" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, variants: {}, error: "模型返回格式错误，已保留原版本" };
  }

  const root = parsed as Record<string, unknown>;
  const variants: AdaptedVariants = {};
  for (const platform of input.platforms) {
    const item = root[platform];
    if (isValidContent(item)) {
      variants[platform] = {
        title: item.title.slice(0, 30),
        description: item.description.slice(0, 200),
        tags: item.tags.map((t) => t.replace(/^#+/, "").trim()).filter(Boolean).slice(0, 8),
      };
    }
  }

  // 至少一个平台成功才算 ok
  if (Object.keys(variants).length === 0) {
    return { ok: false, variants: {}, error: "模型返回内容未通过校验，已保留原版本" };
  }

  return { ok: true, variants };
}

export { ADAPTED_SOURCE };
