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
import { parseExecutionSegments } from "../utils/executionPlan.js";

/** 占位语列表导出，层只相容性。 */
export { PLACEHOLDER_PHRASES };

export type DocumentState = "waiting" | "generating" | "validating" | "repairing" | "completed" | "failed";

/** 每份文档的精确状态：写入 project.json 和 UI 展示。 */
export type DocumentQualityStatus = "generated" | "repaired" | "fallback" | "failed" | "blocked";

export interface DocumentStatusRecord {
  id: string;
  fileName: string;
  status: "completed" | "failed" | "blocked";
  /** 精确状态：generated/repaired/fallback/failed/blocked */
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

function sectionBody(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u"))?.[1]?.trim() || "";
}

function spokenUnits(content: string): number {
  const cjk = content.match(/[\p{Script=Han}]/gu)?.length || 0;
  const latinWords = content.match(/[A-Za-z0-9]+/g)?.length || 0;
  return cjk + latinWords;
}

function normalizedSpokenText(content: string): string {
  return content
    .replace(/[（(][^）)]{0,100}[）)]/gu, "")
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "")
    .toLocaleLowerCase("zh-CN");
}

function durationRange(targetDuration: string | undefined): { min: number; max: number } | null {
  const values = [...(targetDuration || "").matchAll(/(\d{1,3})/g)].map((match) => Number(match[1])).filter((value) => value > 0);
  if (!values.length) return null;
  return { min: values[0], max: values[1] || values[0] };
}

function forbiddenPhrases(value: string | undefined): string[] {
  if (!value || /^无(?:。)?$/u.test(value.trim())) return [];
  const quoted = [...value.matchAll(/[“"']([^“”"']{2,30})[”"']/gu)].map((match) => match[1].trim());
  if (quoted.length) return [...new Set(quoted)];
  return [...new Set(value.split(/[；;、，,\n]/u)
    .map((item) => item.replace(/^(?:禁用|避免|不要|不得|禁止)(?:表达|使用)?[:：]?/u, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 30 && !/^(?:无|没有)$/u.test(item)))];
}

const NEGATABLE_ABSOLUTE_EXPRESSIONS = new Set(["一定", "必然", "所有人都", "每个人都", "任何人都"]);

function isNegatedOccurrence(target: string, index: number): boolean {
  const prefix = target.slice(Math.max(0, index - 6), index).replace(/\s+$/u, "");
  return /(?:不|未|非|并非|并不|不是)$/u.test(prefix);
}

function containsForbiddenExpression(target: string, phrase: string): boolean {
  // “首先其次最后”描述的是结构，不要求三个词在正文里紧挨着。
  if (phrase === "首先其次最后") return /首先[\s\S]*其次[\s\S]*最后/u.test(target);

  let offset = 0;
  while (offset < target.length) {
    const index = target.indexOf(phrase, offset);
    if (index < 0) return false;
    const qualifiedAbsolute = NEGATABLE_ABSOLUTE_EXPRESSIONS.has(phrase) && isNegatedOccurrence(target, index);
    if (!qualifiedAbsolute) return true;
    offset = index + phrase.length;
  }
  return false;
}

function validateForbiddenExpressions(content: string, definition: ProjectDocumentDefinition, brief?: ProjectBrief): string[] {
  const phrases = forbiddenPhrases(brief?.forbiddenExpressions);
  if (!phrases.length || definition.number === "01") return [];
  const target = definition.number === "02"
    ? sectionBody(content, "最终逐字口播稿")
    : [sectionBody(content, "最终发布卡"), sectionBody(content, "平台发布文案")].join("\n");
  return phrases.filter((phrase) => containsForbiddenExpression(target, phrase)).map((phrase) => `最终交付仍包含禁用表达：${phrase}`);
}

function validateCreativeBrief(content: string): string[] {
  const errors: string[] = [];
  if (/\d{2,3}\s*字\s*[\/／每]\s*分钟/u.test(content)) errors.push("创作简报不应凭空锁定固定口播语速，应由最终逐字稿与时间码共同校验");
  const confirmations = sectionBody(content, "人工确认");
  if (/(?:手机|封面).{0,12}(?:预览|回放)|(?:先|需要|建议).{0,8}(?:试录|录一遍|拍一遍)/u.test(confirmations)) {
    errors.push("人工确认混入普通执行提醒，只应保留真正需要用户选择或核实的事项");
  }
  return errors;
}


function retimeShootingExecution(content: string, brief: ProjectBrief | undefined): string | null {
  const range = durationRange(brief?.targetDuration);
  if (!range) return null;
  const lines = content.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const normalized = normalizeHeading(line);
    return line.trim().startsWith("|") && ["时间", "最终口播", "画面动作", "字幕重点", "broll素材", "拍摄状态"].every((term) => normalized.includes(term));
  });
  if (headerIndex < 0) return null;

  const rows: Array<{ lineIndex: number; cells: string[]; units: number; originalDuration: number }> = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index]?.trim() || "";
    if (!/^\|.*\|$/u.test(line)) break;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const parsed = parseExecutionSegments(`${lines[headerIndex]}\n${lines[headerIndex + 1]}\n${line}`)[0];
    if (!parsed) return null;
    rows.push({ lineIndex: index, cells, units: spokenUnits(cells[1] || ""), originalDuration: parsed.durationSeconds });
  }
  if (rows.length < 3) return null;

  // 4.2 gives a safety margin below the validator's hard 4.8 units/second limit.
  const durations = rows.map((row) => Math.max(4, Math.ceil(row.units / 4.2)));
  const minimumTotal = durations.reduce((sum, value) => sum + value, 0);
  if (minimumTotal > range.max) return null;
  const originalTotal = rows.reduce((sum, row) => sum + row.originalDuration, 0);
  const desiredTotal = Math.max(minimumTotal, Math.min(range.max, Math.max(range.min, originalTotal)));
  let remaining = desiredTotal - minimumTotal;
  for (let index = 0; index < durations.length && remaining > 0; index += 1) {
    const add = index === durations.length - 1 ? remaining : Math.min(remaining, Math.max(0, rows[index].originalDuration - durations[index]));
    durations[index] += add;
    remaining -= add;
  }
  for (let index = 0; index < durations.length && remaining > 0; index = (index + 1) % durations.length) {
    durations[index] += 1;
    remaining -= 1;
  }

  let cursor = 0;
  rows.forEach((row, index) => {
    const end = cursor + durations[index];
    row.cells[0] = `${cursor}-${end}秒`;
    lines[row.lineIndex] = `| ${row.cells.join(" | ")} |`;
    cursor = end;
  });
  return lines.join("\n");
}

function validateShootingExecution(content: string, brief: ProjectBrief | undefined, input: GenerateInput): string[] {
  const errors: string[] = [];
  const script = sectionBody(content, "最终逐字口播稿");
  const spokenScript = script.replace(/[（(][^）)]{0,100}[）)]/gu, "").replace(/[*_`>#-]/g, "");
  const units = spokenUnits(spokenScript);
  if (units < 80) errors.push("最终逐字口播稿过短，无法形成完整可拍内容");
  const range = durationRange(brief?.targetDuration);
  if (range && units > range.max * 4.5) errors.push(`最终逐字口播稿约 ${units} 个口播单位，按保守语速超过 ${brief?.targetDuration || "目标时长"}`);
  if (range && units < range.min * 2.5) errors.push(`最终逐字口播稿约 ${units} 个口播单位，明显短于 ${brief?.targetDuration || "目标时长"}`);

  const lines = content.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const normalized = normalizeHeading(line);
    return line.trim().startsWith("|") && ["时间", "最终口播", "画面动作", "字幕重点", "broll素材", "拍摄状态"].every((term) => normalized.includes(term));
  });
  const segments = parseExecutionSegments(content);
  if (headerIndex < 0) {
    errors.push("镜头执行表缺少固定列：时间、最终口播、画面/动作、字幕重点、B-roll/素材、拍摄状态");
  } else {
    let rows = 0;
    for (let index = headerIndex + 2; index < lines.length && /^\s*\|.*\|\s*$/u.test(lines[index] || ""); index += 1) {
      rows += 1;
      if (!/未拍/u.test(lines[index])) errors.push(`镜头执行表第 ${rows} 行拍摄状态必须初始化为“未拍”`);
    }
    if (rows < 3) errors.push("镜头执行表至少需要 3 个可执行时间段");
  }

  if (segments.length >= 3) {
    if (segments[0]?.startSeconds !== 0) errors.push("镜头执行表必须从 0 秒开始");
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const previous = segments[index - 1];
      if (previous && segment.startSeconds !== previous.endSeconds) errors.push(`镜头执行表第 ${index + 1} 行与上一行时间码不连续`);
      const rowUnits = spokenUnits(segment.spokenText);
      if (rowUnits > segment.durationSeconds * 4.8) errors.push(`镜头执行表第 ${index + 1} 行口播无法在 ${segment.durationSeconds} 秒内自然念完`);
    }
    const totalDuration = segments.at(-1)?.endSeconds || 0;
    if (range && (totalDuration < range.min || totalDuration > range.max)) errors.push(`镜头执行表总时长 ${totalDuration} 秒不在 ${brief?.targetDuration || "目标时长"}内`);
    const tableScript = segments.map((segment) => segment.spokenText).join("");
    if (normalizedSpokenText(spokenScript) !== normalizedSpokenText(tableScript)) {
      errors.push("最终逐字口播稿与镜头执行表中的逐行口播不一致，存在两个口径");
    }
  }

  if (/小红书|抖音/u.test(input.platform) && /(?:横屏|横置).{0,10}(?:录制|拍摄|固定|画面)/u.test(content)) {
    errors.push(`${input.platform}短视频执行稿出现横屏或横置要求，应统一为竖屏录制`);
  }

  if (/(?:后续|拍摄前|开拍前|下一步).{0,16}(?:再压缩|再删|删去|重写|通读)|若.{0,12}(?:超时|过长).{0,12}(?:删|压缩)|待确认后再补|等待补拍|不能直接拍|修改后可拍/u.test(content)) {
    errors.push("拍摄执行稿仍把可自动完成的修改留给用户，必须先修复再交付");
  }
  if (!/可直接拍/u.test(sectionBody(content, "锁稿检查"))) errors.push("锁稿检查必须明确写出“可直接拍”");
  return [...new Set(errors)];
}

function supersededPhrases(otherDocuments: Array<{ name: string; content: string }>): string[] {
  return otherDocuments.flatMap((document) => [...document.content.matchAll(/[“"']([^“”"']{2,30})[”"'].{0,10}必须改成/gu)].map((match) => match[1]));
}

function markdownTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!/^\|.*\|$/u.test(trimmed)) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(cells: string[] | null): boolean {
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/u.test(cell)));
}

/** 同时识别“节点在行”与“节点在列”的 Markdown 复盘表。 */
export function reviewCheckpointHasUsableData(review: string, checkpoint: string, allowRecordedResults = false): boolean {
  const lines = review.split("\n");
  const compact = checkpoint.replace(/\s+/gu, "");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const cells = markdownTableCells(lines[lineIndex] || "");
    if (!cells) continue;
    const checkpointIndex = cells.findIndex((cell) => cell.replace(/\s+/gu, "").includes(compact));
    if (checkpointIndex < 0) continue;

    const nextCells = markdownTableCells(lines[lineIndex + 1] || "");
    const values = cells.filter((_cell, index) => index !== checkpointIndex);
    if (isMarkdownTableSeparator(nextCells)) {
      values.length = 0;
      for (let rowIndex = lineIndex + 2; rowIndex < lines.length; rowIndex += 1) {
        const row = markdownTableCells(lines[rowIndex] || "");
        if (!row) break;
        if (!isMarkdownTableSeparator(row)) values.push(row[checkpointIndex] || "");
      }
    }
    const usableValues = values.filter(Boolean);
    if (usableValues.some((value) => /发布后填写/u.test(value))) return true;
    if (allowRecordedResults && usableValues.some((value) => /(?:\d|已完成|已记录|不适用)/u.test(value))) return true;
  }
  return false;
}

function validatePublishAndReview(content: string, input: GenerateInput, otherDocuments: Array<{ name: string; content: string }>, allowRecordedResults = false): string[] {
  const errors: string[] = [];
  const publishCard = sectionBody(content, "最终发布卡");
  if (/这(?:两|二|三|3|2)个字|这(?:2|3|二|三)个信号/u.test(publishCard)) {
    errors.push("最终标题使用了答案不明确或数量含混的悬念表达，应直接说清核心判断");
  }
  const publishRecord = sectionBody(content, "发布记录");
  if (!/发布后填写/u.test(publishRecord) && !(allowRecordedResults && (/https?:\/\//u.test(publishRecord) || /发布状态\s*[：:]\s*(?:已发布|已上线|完成)/u.test(publishRecord)))) errors.push("发布记录中的未知信息必须标记“发布后填写”，或填写真实链接与发布状态");
  if (!/视频/u.test(publishRecord)) errors.push("发布记录必须明确当前交付是视频，而不是图文笔记");
  if (/小红书/u.test(input.platform) && /图文笔记/u.test(publishRecord)) errors.push("小红书发布记录误写为图文笔记，应与视频项目保持一致");
  const review = sectionBody(content, "数据复盘");
  for (const checkpoint of ["24 小时", "72 小时", "7 天"]) {
    const compact = checkpoint.replace(/\s+/g, "");
    if (!review.replace(/\s+/g, "").includes(compact)) errors.push(`数据复盘缺少 ${checkpoint} 回收节点`);
    if (!reviewCheckpointHasUsableData(review, checkpoint, allowRecordedResults)) errors.push(`数据复盘应使用表格，并将 ${checkpoint} 未知数据标记为“发布后填写”，或填写真实结果`);
  }
  if (/评论区高频回复|合作私信|杠精私信|粉丝群公告/u.test(content)) errors.push("发布卡混入账号级通用话术或虚构高频评论");
  if (!allowRecordedResults && /(?:发布时段|发布时间|调整至|建议在)[^。\n]{0,30}\d{1,2}:\d{2}/u.test(content)) {
    errors.push("发布与复盘擅自添加了用户未提供的具体发布时间段");
  }
  if (/同类[^。\n]{0,40}(?:中位数|平均值|基准)/u.test(content)) {
    errors.push("发布与复盘依赖无法确认的同类账号外部基准，应改用本账号发布后的真实数据");
  }
  if (/\d+(?:\.\d+)?\s*[:：]\s*\d+(?:\.\d+)?/u.test(sectionBody(content, "复用与下一步"))) {
    errors.push("复用与下一步擅自添加了用户未提供的数值比例阈值");
  }
  if (/(?:评论区|私信).{0,20}(?:发给你|发你|领取|领一份|图片版|资料包|清单整理成)/u.test(content)) {
    errors.push("发布卡承诺发送尚未确认存在的清单、图片或资料包");
  }
  const upstream = otherDocuments.map((document) => document.content).join("\n");
  const numericClaims = [
    ...content.matchAll(/(?:低于|高于|超过|达到|不足)\s*\d+(?:\.\d+)?\s*%/gu),
    ...content.matchAll(/(?:超过|达到|至少)\s*\d+\s*人/gu),
    ...content.matchAll(/(?:投放|推广|预算|薯条)[^。\n]{0,20}\d+(?:\.\d+)?\s*元/gu),
  ].map((match) => match[0]);
  const ungrounded = numericClaims.filter((claim) => !upstream.includes(claim));
  if (ungrounded.length) errors.push(`发布与复盘擅自添加未确认的数据或投放阈值：${ungrounded.slice(0, 3).join("、")}`);
  const stale = supersededPhrases(otherDocuments).filter((phrase) => content.includes(phrase));
  if (stale.length) errors.push(`发布文案重新引入了上游已替换的旧表达：${[...new Set(stale)].join("、")}`);
  return [...new Set(errors)];
}

export interface DocumentValidationOptions {
  allowRecordedResults?: boolean;
}

export function validateDocument(content: string, definition: ProjectDocumentDefinition, input: GenerateInput, otherDocuments: Array<{ name: string; content: string }> = [], brief?: ProjectBrief, options: DocumentValidationOptions = {}): string[] {
  const errors: string[] = [];
  const normalized = content.trim();
  if (!normalized) return ["文档为空"];
  if (normalized.length < definition.minLength) errors.push(`正文长度不足 ${definition.minLength} 字符`);
  if (normalized.length > definition.maxLength) errors.push(`正文超过 ${definition.maxLength} 字符，应删除重复解释和非必要扩写`);
  for (const phrase of PLACEHOLDERS) if (normalized.includes(phrase)) errors.push(`包含占位语：${phrase}`);
  // “禁用表达”清单会主动列出需要禁止的词，不能把清单本身误判为正文 AI 味。
  const proseForSlopCheck = normalized.split("\n")
    .filter((line) => !/(?:禁用|禁止|避免|不得|不要使用|不使用).{0,12}(?:表达|词|措辞|说法)?/u.test(line))
    .join("\n");
  const slopHits = AI_SLOP_PHRASES.filter((phrase) => proseForSlopCheck.includes(phrase));
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
  if (definition.number === "01") errors.push(...validateCreativeBrief(normalized));
  if (definition.number === "02") errors.push(...validateShootingExecution(normalized, brief, input));
  if (definition.number === "03") errors.push(...validatePublishAndReview(normalized, input, otherDocuments, options.allowRecordedResults));
  errors.push(...validateForbiddenExpressions(normalized, definition, brief));
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

/**
 * A missing or slightly malformed top-level title is a mechanical formatting
 * defect, not a content defect. Normalize it locally so a complete document
 * is not discarded just because the model omitted one Markdown line.
 */
function normalizeDocumentTitle(content: string, definition: ProjectDocumentDefinition): string {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  const escapedTitle = definition.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^#\\s+${escapedTitle}\\s*$`, "mu").test(normalized)) return normalized;
  const lines = normalized.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim());
  if (firstContentLine >= 0 && /^#\s+/u.test(lines[firstContentLine].trim())) {
    lines[firstContentLine] = `# ${definition.title}`;
    return lines.join("\n").trim();
  }
  return `# ${definition.title}\n\n${normalized}`;
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
  referenceContext = "",
): Promise<ProjectBrief> {
  const prompt = buildProjectBriefPrompt(input, accountMemoryPrompt, referenceContext);
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
  const parsedText = (key: string, fallback: string) => typeof parsed[key] === "string" && parsed[key].trim() ? parsed[key].trim() : fallback;
  return {
    topic: input.topic,
    contentSubject: parsedText("contentSubject", input.contentSubject),
    contentDomain: parsedText("contentDomain", input.contentDomain),
    platform: parsedText("platform", input.platform),
    style: parsedText("style", input.style),
    targetAudience: parsedText("targetAudience", input.targetAudience),
    extraRequirements: input.extraRequirements || "无",
    coreViewpoint: typeof parsed.coreViewpoint === "string" && parsed.coreViewpoint.trim() ? parsed.coreViewpoint.trim() : input.topic,
    contentStructure: typeof parsed.contentStructure === "string" && parsed.contentStructure.trim() ? parsed.contentStructure.trim() : "明确问题 → 给出核心判断 → 展开步骤或案例 → 风险提醒与行动建议",
    targetDuration: typeof parsed.targetDuration === "string" && parsed.targetDuration.trim() ? parsed.targetDuration.trim() : "45-60秒",
    requiredElements: typeof parsed.requiredElements === "string" && parsed.requiredElements.trim() ? parsed.requiredElements.trim() : "保留核心观点与必要事实依据",
    forbiddenExpressions: typeof parsed.forbiddenExpressions === "string" && parsed.forbiddenExpressions.trim() ? parsed.forbiddenExpressions.trim() : "无",
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
      const content = normalizeDocumentTitle(parseDocument(raw, definition), definition);
      lastErrors = validateDocument(content, definition, input, acceptedDocuments, brief);
      const durationMs = Math.round(performance.now() - started);
      if (!lastErrors.length) {
        onModelCall?.({ documentId: definition.number, fileName: definition.filename, attempt: attempt + 1, mode: retrying ? "repair" : "generate", startedAt, durationMs, promptChars: prompt.length, outputChars: raw.length, status: "completed", ...metrics });
        return { definition, content, repaired: retrying, validationErrors: [] };
      }
      const onlyTimelineErrors = definition.number === "02" && lastErrors.every((error) => /口播无法在|总时长|时间码不连续|必须从 0 秒开始/u.test(error));
      if (onlyTimelineErrors) {
        const retimed = retimeShootingExecution(content, brief);
        const retimedErrors = retimed ? validateDocument(retimed, definition, input, acceptedDocuments, brief) : lastErrors;
        if (retimed && !retimedErrors.length) {
          onModelCall?.({ documentId: definition.number, fileName: definition.filename, attempt: attempt + 1, mode: retrying ? "repair" : "generate", startedAt, durationMs, promptChars: prompt.length, outputChars: raw.length, status: "completed", message: "已在本地重新分配镜头时间码", ...metrics });
          return { definition, content: retimed, repaired: true, validationErrors: [] };
        }
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
  const blocked = !completed && result.validationErrors.some((error) => /本次未生成/u.test(error));
  let documentStatus: DocumentQualityStatus;
  if (blocked) {
    documentStatus = "blocked";
  } else if (!completed) {
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
    status: completed && !hasFallbackContent ? "completed" : blocked ? "blocked" : "failed",
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
