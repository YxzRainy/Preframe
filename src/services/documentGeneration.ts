import { buildDocumentPrompt, buildDocumentRepairPrompt, buildProjectBriefPrompt, type GenerateInput, type ProjectBrief } from "../prompts/generatePrompt.js";
import { cleanModelOutput, parseModelJsonObject } from "../utils/modelJson.js";
import { PLACEHOLDER_PHRASES, PROJECT_DOCUMENT_DEFINITIONS, type ProjectDocumentDefinition } from "../utils/documentDefinitions.js";
import {
  callModel,
  modelFailureKind,
  type CallModelOptions,
  type ModelFailureKind,
  type ModelResponseMetrics,
} from "./modelClient.js";
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

/** 首次生成失败后仅允许一次分类重试，避免单份文档放大为长时间阻塞。 */
export const DOCUMENT_RETRY_LIMIT = 1;

export type GenerationCallFailureKind = ModelFailureKind | "parse" | "validation" | "deadline";

export interface GenerationModelCallRecord {
  documentId: string;
  fileName: string;
  attempt: number;
  mode: "generate" | "repair";
  startedAt: string;
  durationMs: number;
  promptChars: number;
  outputChars?: number;
  status: "completed" | "invalid" | "failed";
  failureKind?: GenerationCallFailureKind;
  message?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 仅在模型响应无法直接使用时保留，供本地恢复与诊断。 */
  rawOutput?: string;
}

type DocumentModelCall = (prompt: string, options?: CallModelOptions) => Promise<string>;

function taskDeadlineReached(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError");
}

function shouldRetryModelFailure(kind: ModelFailureKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "length";
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

function validateQualityCheckReport(content: string): string[] {
  const errors: string[] = [];
  const lines = content.split("\n");
  let matchingTableRows = 0;
  let hasHighPriority = false;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() || "";
    const separator = lines[index + 1]?.trim() || "";
    if (!/^\|.*\|$/u.test(header) || !/^\|(?:\s*:?-{3,}:?\s*\|)+$/u.test(separator)) continue;
    const normalizedHeader = normalizeHeading(header);
    if (!["文档", "原表达", "问题", "替换", "优先级"].every((term) => normalizedHeader.includes(term))) continue;

    for (let rowIndex = index + 2; rowIndex < lines.length && /^\|.*\|$/u.test(lines[rowIndex]?.trim() || ""); rowIndex += 1) {
      const row = lines[rowIndex].trim();
      if (!row.replace(/[|\s]/gu, "")) continue;
      matchingTableRows += 1;
      if (/\|\s*(?:高|P[01])(?:\s*优先级)?\s*\|?$/iu.test(row)) hasHighPriority = true;
    }
    break;
  }

  if (matchingTableRows < 3) errors.push("质检报告缺少至少 3 条带原文证据和替换句的修改表");
  if (matchingTableRows >= 3 && !hasHighPriority) errors.push("质检报告修改表缺少高优先级事项");
  if (!/(?:可直接发布|修改后可发布|不建议发布)/u.test(content)) errors.push("质检报告缺少明确发布结论");
  return errors;
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
  if (definition.number === "08") errors.push(...validateQualityCheckReport(normalized));
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

function markdownDocumentFromRaw(raw: string, definition: ProjectDocumentDefinition): string | null {
  const cleaned = cleanModelOutput(raw);
  const candidates = [cleaned];
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed === "string") candidates.unshift(parsed.trim());
  } catch {
    // Bare Markdown is handled below.
  }

  const titlePattern = new RegExp(`^#\\s+${definition.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "mu");
  for (const candidate of candidates) {
    const match = titlePattern.exec(candidate);
    if (match?.index !== undefined) return candidate.slice(match.index).trim();
  }
  return null;
}

function parseDocument(raw: string, definition: ProjectDocumentDefinition): string {
  let parseError: unknown;
  try {
    const parsed = parseModelJsonObject(raw, "单文档模型输出");
    if (typeof parsed.content === "string" && parsed.content.trim()) return parsed.content.trim();
    parseError = new Error("缺少 content 字段");
  } catch (error) {
    parseError = error;
  }

  const markdown = markdownDocumentFromRaw(raw, definition);
  if (markdown) return markdown;
  throw parseError;
}

export async function createProjectBrief(
  input: GenerateInput,
  accountMemoryPrompt: string,
  signal?: AbortSignal,
  onModelCall?: (record: GenerationModelCallRecord) => void,
): Promise<ProjectBrief> {
  const prompt = buildProjectBriefPrompt(input, accountMemoryPrompt);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let metrics: ModelResponseMetrics = {};
  let raw = "";
  try {
    raw = await callModel(prompt, { signal, onMetrics: (value) => { metrics = value; } });
  } catch (error) {
    const kind: GenerationCallFailureKind = taskDeadlineReached(signal) ? "deadline" : modelFailureKind(error);
    onModelCall?.({ documentId: "brief", fileName: "projectBrief", attempt: 1, mode: "generate", startedAt, durationMs: Math.round(performance.now() - started), promptChars: prompt.length, status: "failed", failureKind: kind, message: error instanceof Error ? error.message : String(error), ...metrics });
    throw error;
  }
  let parsed: Record<string, unknown> = {};
  let parseMessage = "";
  try {
    parsed = parseModelJsonObject(raw, "projectBrief");
  } catch (error) {
    parseMessage = error instanceof Error ? error.message : String(error);
  }
  onModelCall?.({
    documentId: "brief",
    fileName: "projectBrief",
    attempt: 1,
    mode: "generate",
    startedAt,
    durationMs: Math.round(performance.now() - started),
    promptChars: prompt.length,
    outputChars: raw.length,
    status: parseMessage ? "invalid" : "completed",
    ...(parseMessage ? { failureKind: "parse" as const, message: `${parseMessage}；已使用输入信息构建安全简报` } : {}),
    ...metrics,
  });
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
  modelCall?: DocumentModelCall;
  onModelCall?: (record: GenerationModelCallRecord) => void;
}): Promise<GeneratedDocumentResult> {
  const { definition, input, brief, context = "", accountMemoryPrompt = "", acceptedDocuments = [], signal, onState, modelCall = callModel, onModelCall } = args;
  let lastErrors: string[] = [];
  let raw = "";

  for (let attempt = 0; attempt <= DOCUMENT_RETRY_LIMIT; attempt += 1) {
    if (signal?.aborted) {
      if (!taskDeadlineReached(signal)) throw signal.reason || new DOMException("任务已取消", "AbortError");
      lastErrors = ["任务达到 06:00 截止时间，已停止继续调用模型"];
      break;
    }
    const retrying = attempt > 0;
    onState?.(retrying && raw ? "repairing" : "generating", retrying ? lastErrors : undefined);
    const prompt = !retrying
      ? buildDocumentPrompt(brief, definition, context, accountMemoryPrompt)
      : raw
        ? buildDocumentRepairPrompt(raw, lastErrors, definition, brief, input, context, accountMemoryPrompt)
        : buildDocumentPrompt(brief, definition, context, accountMemoryPrompt, true);
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let metrics: ModelResponseMetrics = {};
    let receivedResponse = false;
    try {
      raw = await modelCall(prompt, { signal, onMetrics: (value) => { metrics = value; } });
      receivedResponse = true;
      onState?.("validating");
      const content = parseDocument(raw, definition);
      lastErrors = validateDocument(content, definition, input, acceptedDocuments);
      const durationMs = Math.round(performance.now() - started);
      if (!lastErrors.length) {
        onModelCall?.({ documentId: definition.number, fileName: definition.filename, attempt: attempt + 1, mode: retrying ? "repair" : "generate", startedAt, durationMs, promptChars: prompt.length, outputChars: raw.length, status: "completed", ...metrics });
        return { definition, content, repaired: retrying, validationErrors: [] };
      }
      onModelCall?.({ documentId: definition.number, fileName: definition.filename, attempt: attempt + 1, mode: retrying ? "repair" : "generate", startedAt, durationMs, promptChars: prompt.length, outputChars: raw.length, status: "invalid", failureKind: "validation", message: lastErrors.join("；"), rawOutput: raw, ...metrics });
    } catch (error) {
      if (signal?.aborted && !taskDeadlineReached(signal)) throw error;
      const durationMs = Math.round(performance.now() - started);
      const kind: GenerationCallFailureKind = taskDeadlineReached(signal)
        ? "deadline"
        : receivedResponse && modelFailureKind(error) === "unknown"
          ? "parse"
          : modelFailureKind(error);
      lastErrors = [kind === "deadline" ? "任务达到 06:00 截止时间，已停止继续调用模型" : error instanceof Error ? error.message : retrying ? "重试解析失败" : "解析失败"];
      onModelCall?.({ documentId: definition.number, fileName: definition.filename, attempt: attempt + 1, mode: retrying ? "repair" : "generate", startedAt, durationMs, promptChars: prompt.length, outputChars: raw.length || undefined, status: "failed", failureKind: kind, message: lastErrors[0], ...(receivedResponse ? { rawOutput: raw } : {}), ...metrics });
      if (kind === "deadline" || kind === "timeout" || kind === "auth" || kind === "config" || kind === "cancelled") break;
      if (kind !== "parse" && !shouldRetryModelFailure(kind)) break;
    }
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
