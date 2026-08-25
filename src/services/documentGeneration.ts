import { buildDocumentPrompt, buildDocumentRepairPrompt, buildProjectBriefPrompt, type GenerateInput, type ProjectBrief } from "../prompts/generatePrompt.js";
import { parseModelJsonObject } from "../utils/modelJson.js";
import { PLACEHOLDER_PHRASES, PROJECT_DOCUMENT_DEFINITIONS, type ProjectDocumentDefinition } from "../utils/documentDefinitions.js";
import { callModel } from "./modelClient.js";
import { AI_SLOP_PHRASES } from "../prompts/humanWritingRules.js";

/** 占位语列表导出，层只相容性。 */
export { PLACEHOLDER_PHRASES };

export type DocumentState = "waiting" | "generating" | "validating" | "repairing" | "completed" | "failed";

/** 每份文档的精确状态：写入 project.json 和 UI 展示。 */
export type DocumentQualityStatus = "generated" | "repaired" | "fallback" | "failed";

export interface DocumentStatusRecord {
  id: string;
  fileName: string;
  status: "completed" | "failed";
  /** 精确状态：generated/repaired/fallback/failed */
  documentStatus: DocumentQualityStatus;
  generated: boolean;
  repaired: boolean;
  failed: boolean;
  validationErrors: string[];
}

export interface GeneratedDocumentResult {
  definition: ProjectDocumentDefinition;
  content?: string;
  repaired: boolean;
  validationErrors: string[];
}

const PLACEHOLDERS: readonly string[] = PLACEHOLDER_PHRASES;

function normalizeHeading(value: string): string {
  return value.replace(/[\s：:／/\-]/gu, "").toLowerCase();
}

function relevanceSignals(input: GenerateInput): string[] {
  return [input.topic, input.contentSubject, input.contentDomain, input.platform, input.targetAudience]
    .flatMap((value) => [value.trim(), ...value.split(/[，。！？、\s/]+/u)])
    .filter((value) => value.length >= 2);
}

function similarity(left: string, right: string): number {
  const chunks = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 7) }, (_, index) => value.slice(index, index + 8)));
  const a = chunks(left.replace(/\s+/gu, ""));
  const b = chunks(right.replace(/\s+/gu, ""));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

export function validateDocument(content: string, definition: ProjectDocumentDefinition, input: GenerateInput, otherDocuments: Array<{ name: string; content: string }> = []): string[] {
  const errors: string[] = [];
  const normalized = content.trim();
  if (!normalized) return ["文档为空"];
  if (normalized.length < definition.minLength) errors.push(`正文长度不足 ${definition.minLength} 字符`);
  for (const phrase of PLACEHOLDERS) if (normalized.includes(phrase)) errors.push(`包含占位语：${phrase}`);
  const slopHits = AI_SLOP_PHRASES.filter((phrase) => normalized.includes(phrase));
  if (slopHits.length >= 2) errors.push(`AI 味表达过多：${slopHits.slice(0, 4).join("、")}`);
  const paragraphStarts = normalized.split(/\n{2,}/u).map((paragraph) => paragraph.trim().slice(0, 18)).filter(Boolean);
  const repeatedStarts = paragraphStarts.filter((start, index) => paragraphStarts.indexOf(start) !== index);
  if (repeatedStarts.length >= 2) errors.push("段落开头重复，缺少自然的表达变化");
  if (!new RegExp(`^#\\s+${definition.title}\\s*$`, "mu").test(normalized)) errors.push(`缺少一级标题：${definition.title}`);
  const headings = normalized.split("\n").filter((line) => /^##\s+/u.test(line)).map((line) => normalizeHeading(line.replace(/^##\s+/u, "")));
  for (const section of definition.requiredSections) {
    const expected = normalizeHeading(section);
    if (!headings.some((heading) => heading.includes(expected) || expected.includes(heading))) errors.push(`缺少二级标题：${section}`);
  }
  const signals = relevanceSignals(input);
  if (!signals.some((signal) => normalized.includes(signal))) errors.push("与当前选题、主体、平台或目标用户缺少明确关联");
  for (const other of otherDocuments) {
    if (similarity(normalized, other.content) >= 0.88) {
      errors.push(`与 ${other.name} 高度重复`);
      break;
    }
  }
  return [...new Set(errors)];
}

function parseDocument(raw: string): string {
  const parsed = parseModelJsonObject(raw, "单文档模型输出");
  if (typeof parsed.content !== "string" || !parsed.content.trim()) throw new Error("缺少 content 字段");
  return parsed.content.trim();
}

export async function createProjectBrief(input: GenerateInput, accountMemoryPrompt: string, signal?: AbortSignal): Promise<ProjectBrief> {
  const raw = await callModel(buildProjectBriefPrompt(input, accountMemoryPrompt), { signal });
  let parsed: Record<string, unknown> = {};
  try { parsed = parseModelJsonObject(raw, "projectBrief"); } catch { /* Input-derived brief remains safe and consistent. */ }
  return {
    topic: input.topic,
    contentSubject: input.contentSubject,
    contentDomain: input.contentDomain,
    platform: input.platform,
    style: input.style,
    targetAudience: input.targetAudience,
    extraRequirements: input.extraRequirements || "无",
    coreViewpoint: typeof parsed.coreViewpoint === "string" && parsed.coreViewpoint.trim() ? parsed.coreViewpoint.trim() : input.topic,
    contentStructure: typeof parsed.contentStructure === "string" && parsed.contentStructure.trim() ? parsed.contentStructure.trim() : "明确问题 → 给出核心判断 → 展开步骤或案例 → 风险提醒与行动建议",
    riskBoundaries: typeof parsed.riskBoundaries === "string" && parsed.riskBoundaries.trim() ? parsed.riskBoundaries.trim() : "不编造事实，不夸张承诺，遵守平台规范与内容边界。",
  };
}

export async function generateValidatedDocument(args: {
  definition: ProjectDocumentDefinition;
  input: GenerateInput;
  brief: ProjectBrief;
  context?: string;
  accountMemoryPrompt?: string;
  acceptedDocuments?: Array<{ name: string; content: string }>;
  signal?: AbortSignal;
  onState?: (state: DocumentState, errors?: string[]) => void;
}): Promise<GeneratedDocumentResult> {
  const { definition, input, brief, context = "", accountMemoryPrompt = "", acceptedDocuments = [], signal, onState } = args;
  let lastErrors: string[] = [];
  let raw = "";
  onState?.("generating");
  try {
    raw = await callModel(buildDocumentPrompt(brief, definition, context, accountMemoryPrompt), { signal });
    onState?.("validating");
    const content = parseDocument(raw);
    lastErrors = validateDocument(content, definition, input, acceptedDocuments);
    if (!lastErrors.length) return { definition, content, repaired: false, validationErrors: [] };
  } catch (error) {
    lastErrors = [error instanceof Error ? error.message : "解析失败"];
  }

  onState?.("repairing", lastErrors);
  try {
    const repairedRaw = await callModel(buildDocumentRepairPrompt(raw, lastErrors, definition), { signal });
    onState?.("validating");
    const content = parseDocument(repairedRaw);
    lastErrors = validateDocument(content, definition, input, acceptedDocuments);
    if (!lastErrors.length) return { definition, content, repaired: true, validationErrors: [] };
  } catch (error) {
    lastErrors = [error instanceof Error ? error.message : "修复解析失败"];
  }

  onState?.("generating", lastErrors);
  try {
    const regeneratedRaw = await callModel(buildDocumentPrompt(brief, definition, context, accountMemoryPrompt, true), { signal });
    onState?.("validating");
    const content = parseDocument(regeneratedRaw);
    lastErrors = validateDocument(content, definition, input, acceptedDocuments);
    if (!lastErrors.length) return { definition, content, repaired: false, validationErrors: [] };
  } catch (error) {
    lastErrors = [error instanceof Error ? error.message : "重新生成解析失败"];
  }

  onState?.("failed", lastErrors);
  return { definition, repaired: false, validationErrors: lastErrors };
}

export function statusRecord(result: GeneratedDocumentResult): DocumentStatusRecord {
  const completed = Boolean(result.content);
  // 检测 fallback：无内容但 validationErrors 含占位相关错误，或内容本身含占位语
  const hasFallbackContent = completed && PLACEHOLDER_PHRASES.some((phrase) => result.content!.includes(phrase));
  let documentStatus: DocumentQualityStatus;
  if (!completed) {
    documentStatus = "failed";
  } else if (hasFallbackContent) {
    documentStatus = "fallback";
  } else if (result.repaired) {
    documentStatus = "repaired";
  } else {
    documentStatus = "generated";
  }
  return {
    id: result.definition.number,
    fileName: result.definition.filename,
    status: completed && !hasFallbackContent ? "completed" : "failed",
    documentStatus,
    generated: completed && !hasFallbackContent,
    repaired: completed && !hasFallbackContent && result.repaired,
    failed: !completed || hasFallbackContent,
    validationErrors: result.validationErrors,
  };
}

export function definitionByNumber(number: string): ProjectDocumentDefinition | undefined {
  return PROJECT_DOCUMENT_DEFINITIONS.find((definition) => definition.number === number.padStart(2, "0"));
}
