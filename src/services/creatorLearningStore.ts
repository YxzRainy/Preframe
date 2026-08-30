import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createId, nowIso, readJsonFile, writeJsonFile } from "./localStore.js";
import { listProjects } from "./projectManager.js";
import { listShootingFeedback } from "./shootingFeedback.js";
import type { ShootingFeedback } from "../types/shootingFeedback.js";
import type {
  CreatorLearningStore,
  CreatorLearningSummary,
  CreatorStrategy,
  LearningCategory,
  LearningFact,
  LearningPattern,
} from "../types/creatorLearning.js";

const STORE_NAME = "creator-learning";
const MAX_FACT_LENGTH = 360;

function emptyStore(): CreatorLearningStore {
  return { version: 1, facts: [], patterns: [], strategies: [] };
}

function cleanText(value: unknown, limit = MAX_FACT_LENGTH): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit)
    : "";
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function sourceFact(
  sourceProjectSlug: string,
  sourceProjectName: string,
  sourceRef: string,
  sourceType: LearningFact["sourceType"],
  category: LearningCategory,
  text: string,
): LearningFact | null {
  const cleaned = cleanText(text);
  if (cleaned.length < 4) return null;
  const sourceKey = stableHash([sourceProjectSlug, sourceRef, category, cleaned].join("\n"));
  return {
    id: `fact_${sourceKey}`,
    sourceKey,
    sourceType,
    sourceProjectSlug,
    sourceProjectName,
    sourceRef,
    category,
    text: cleaned,
    status: "pending",
    createdAt: nowIso(),
  };
}

export function deriveLearningFactsFromFeedback(
  projectSlug: string,
  projectName: string,
  feedback: ShootingFeedback,
): LearningFact[] {
  const facts: Array<LearningFact | null> = [];
  feedback.onSetIssues.forEach((text, index) => facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:on-set:${index}`, "shooting", "shooting", text)));
  feedback.shotRecords.forEach((record, index) => {
    if (record.issue) facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:shot:${index}:issue`, "shooting", record.outcome === "reshoot" ? "workflow" : "shooting", record.issue));
    if (record.note) facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:shot:${index}:note`, "shooting", "visual", record.note));
    if (record.outcome === "reshoot" || record.outcome === "removed") {
      const label = record.label || `第 ${record.order} 镜头`;
      facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:shot:${index}:outcome`, "shooting", "workflow", `${label} 的现场结果是${record.outcome === "reshoot" ? "需要补拍" : "未进入成片"}${record.issue ? `：${record.issue}` : ""}`));
    }
    if (record.plannedDurationSeconds && record.actualDurationSeconds && Math.abs(record.actualDurationSeconds - record.plannedDurationSeconds) >= 3) {
      facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:shot:${index}:duration`, "shooting", "script", `${record.label || `第 ${record.order} 镜头`}计划 ${record.plannedDurationSeconds} 秒，实际 ${record.actualDurationSeconds} 秒`));
    }
  });
  feedback.addedShots.forEach((record, index) => facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:added:${index}`, "shooting", "visual", `现场新增镜头“${record.label}”${record.reason ? `，原因：${record.reason}` : ""}`)));
  if (feedback.overallNote) facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:overall`, "shooting", "workflow", feedback.overallNote));
  if (feedback.scriptAdjustments) facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:script`, "shooting", "script", feedback.scriptAdjustments));
  if (feedback.storyboardAdjustments) facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:storyboard`, "shooting", "visual", feedback.storyboardAdjustments));
  if (feedback.checklistAdjustments) facts.push(sourceFact(projectSlug, projectName, `${feedback.id}:checklist`, "shooting", "shooting", feedback.checklistAdjustments));
  return facts.filter((item): item is LearningFact => item !== null);
}

function markdownSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return content.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u"))?.[1]?.trim() || "";
}

function meaningfulPublishingLines(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/u, "").trim())
    .filter((line) => line.length >= 6)
    .filter((line) => !/发布后填写|待填写|待确认|暂无|^-+$/u.test(line))
    .filter((line) => !/计划|目标|预计|建议|阈值|待决定|待执行/u.test(line))
    .filter((line) => /\d|https?:\/\/|已发布|已上线|已完成|不适用/u.test(line));
}

export function derivePublishingFacts(
  projectSlug: string,
  projectName: string,
  content: string,
): LearningFact[] {
  const facts: Array<LearningFact | null> = [];
  const record = markdownSection(content, "发布记录");
  const review = markdownSection(content, "数据复盘");
  meaningfulPublishingLines(record).forEach((line, index) => facts.push(sourceFact(projectSlug, projectName, `publish-record:${index}`, "publishing", "publishing", line)));
  meaningfulPublishingLines(review).forEach((line, index) => facts.push(sourceFact(projectSlug, projectName, `publish-review:${index}`, "publishing", "performance", line)));
  return facts.filter((item): item is LearningFact => item !== null);
}

function normalizeForSimilarity(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s\d]+/gu, "");
}

function chunks(value: string): Set<string> {
  const normalized = normalizeForSimilarity(value);
  const size = normalized.length < 8 ? 2 : 3;
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) result.add(normalized.slice(index, index + size));
  return result;
}

function similarity(left: string, right: string): number {
  const a = chunks(left);
  const b = chunks(right);
  if (!a.size || !b.size) return left === right ? 1 : 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

export function buildCandidatePatterns(facts: LearningFact[], previous: LearningPattern[] = []): LearningPattern[] {
  const confirmed = facts.filter((fact) => fact.status === "confirmed");
  const groups: LearningFact[][] = [];
  for (const fact of confirmed) {
    let target = groups.find((group) => group[0].category === fact.category && group.some((item) => similarity(item.text, fact.text) >= 0.42));
    if (!target) {
      target = [];
      groups.push(target);
    }
    target.push(fact);
  }
  const previousByKey = new Map(previous.map((pattern) => [pattern.patternKey, pattern]));
  const now = nowIso();
  return groups
    .filter((group) => new Set(group.map((fact) => fact.sourceProjectSlug)).size >= 2)
    .map((group) => {
      const representative = [...group].sort((a, b) => b.text.length - a.text.length)[0];
      const supportingFactIds = [...new Set(group.map((fact) => fact.id))].sort();
      const supportingProjectSlugs = [...new Set(group.map((fact) => fact.sourceProjectSlug))].sort();
      const matchedExisting = previous.find((pattern) => pattern.category === representative.category && similarity(pattern.statement.replace(/^多个项目反复出现[：:]\s*/u, ""), representative.text) >= 0.42);
      const patternKey = matchedExisting?.patternKey || stableHash([representative.category, normalizeForSimilarity(representative.text)].join("|"));
      const existing = previousByKey.get(patternKey) || matchedExisting;
      return {
        id: existing?.id || `pattern_${patternKey}`,
        patternKey,
        category: representative.category,
        statement: existing?.statement || `多个项目反复出现：${representative.text}`,
        supportingFactIds,
        supportingProjectSlugs,
        status: existing?.status || "candidate",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        ...(existing?.decidedAt ? { decidedAt: existing.decidedAt } : {}),
      } satisfies LearningPattern;
    });
}

async function loadStore(): Promise<CreatorLearningStore> {
  const stored = await readJsonFile<CreatorLearningStore>(STORE_NAME, emptyStore());
  return {
    version: 1,
    facts: Array.isArray(stored.facts) ? stored.facts : [],
    patterns: Array.isArray(stored.patterns) ? stored.patterns : [],
    strategies: Array.isArray(stored.strategies) ? stored.strategies : [],
    ...(typeof stored.lastScannedAt === "string" ? { lastScannedAt: stored.lastScannedAt } : {}),
  };
}

async function saveStore(store: CreatorLearningStore): Promise<void> {
  await writeJsonFile(STORE_NAME, store);
}

function withSummary(store: CreatorLearningStore): CreatorLearningSummary {
  return {
    ...store,
    counts: {
      pendingFacts: store.facts.filter((fact) => fact.status === "pending").length,
      confirmedFacts: store.facts.filter((fact) => fact.status === "confirmed").length,
      candidatePatterns: store.patterns.filter((pattern) => pattern.status === "candidate").length,
      activeStrategies: store.strategies.filter((strategy) => strategy.status === "active").length,
    },
  };
}

export async function getCreatorLearning(): Promise<CreatorLearningSummary> {
  return withSummary(await loadStore());
}

export async function scanCreatorLearning(): Promise<CreatorLearningSummary> {
  const [projects, existing] = await Promise.all([listProjects(), loadStore()]);
  const discovered: LearningFact[] = [];
  for (const project of projects) {
    let projectName = project.name;
    try {
      const metadata = JSON.parse(await readFile(path.join(project.path, "project.json"), "utf8")) as Record<string, unknown>;
      projectName = typeof metadata.projectName === "string" && metadata.projectName.trim()
        ? metadata.projectName : typeof metadata.topic === "string" && metadata.topic.trim() ? metadata.topic : project.name;
    } catch { /* use slug */ }
    const feedback = await listShootingFeedback(project.name).catch(() => []);
    feedback.forEach((item) => discovered.push(...deriveLearningFactsFromFeedback(project.name, projectName, item)));
    const publishing = await readFile(path.join(project.path, "03_发布与复盘.md"), "utf8").catch(() => "");
    if (publishing) discovered.push(...derivePublishingFacts(project.name, projectName, publishing));
  }

  const oldByKey = new Map(existing.facts.map((fact) => [fact.sourceKey, fact]));
  const mergedFacts = discovered.map((fact) => {
    const old = oldByKey.get(fact.sourceKey);
    return old ? { ...fact, id: old.id, status: old.status, createdAt: old.createdAt, ...(old.decidedAt ? { decidedAt: old.decidedAt } : {}) } : fact;
  });
  const stillRelevant = new Set(mergedFacts.map((fact) => fact.sourceKey));
  for (const old of existing.facts) if (!stillRelevant.has(old.sourceKey) && old.status !== "pending") mergedFacts.push(old);

  const patterns = buildCandidatePatterns(mergedFacts, existing.patterns);
  const patternIds = new Set(patterns.map((pattern) => pattern.id));
  const strategies = existing.strategies.filter((strategy) => patternIds.has(strategy.patternId) || strategy.status === "retired");
  const store: CreatorLearningStore = { version: 1, facts: mergedFacts, patterns, strategies, lastScannedAt: nowIso() };
  await saveStore(store);
  return withSummary(store);
}

export async function decideLearningItem(
  kind: "fact" | "pattern" | "strategy",
  id: string,
  decision: "confirm" | "reject" | "retire" | "reactivate",
): Promise<CreatorLearningSummary> {
  const store = await loadStore();
  const now = nowIso();
  if (kind === "fact") {
    const fact = store.facts.find((item) => item.id === id);
    if (!fact) throw new Error("候选事实不存在。");
    if (decision !== "confirm" && decision !== "reject") throw new Error("事实仅支持确认或忽略。");
    fact.status = decision === "confirm" ? "confirmed" : "rejected";
    fact.decidedAt = now;
    store.patterns = buildCandidatePatterns(store.facts, store.patterns);
  } else if (kind === "pattern") {
    const pattern = store.patterns.find((item) => item.id === id);
    if (!pattern) throw new Error("候选规律不存在。");
    if (decision !== "confirm" && decision !== "reject") throw new Error("规律仅支持确认或忽略。");
    pattern.status = decision === "confirm" ? "confirmed" : "rejected";
    pattern.decidedAt = now;
    pattern.updatedAt = now;
    if (decision === "confirm") {
      const existing = store.strategies.find((item) => item.patternId === pattern.id);
      if (existing) {
        existing.statement = pattern.statement;
        existing.supportingFactIds = pattern.supportingFactIds;
        existing.status = "active";
        existing.updatedAt = now;
      } else {
        store.strategies.push({
          id: createId("strategy"),
          patternId: pattern.id,
          category: pattern.category,
          statement: pattern.statement.replace(/^多个项目反复出现[：:]\s*/u, ""),
          supportingFactIds: pattern.supportingFactIds,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  } else {
    const strategy = store.strategies.find((item) => item.id === id);
    if (!strategy) throw new Error("账号策略不存在。");
    if (decision !== "retire" && decision !== "reactivate") throw new Error("策略仅支持停用或恢复。");
    strategy.status = decision === "retire" ? "retired" : "active";
    strategy.updatedAt = now;
  }
  await saveStore(store);
  return withSummary(store);
}

export async function getActiveCreatorStrategies(): Promise<CreatorStrategy[]> {
  return (await loadStore()).strategies.filter((strategy) => strategy.status === "active");
}

export async function creatorLearningPrompt(): Promise<string> {
  const strategies = await getActiveCreatorStrategies();
  if (!strategies.length) return "";
  return `已由用户确认、可以跨项目复用的创作者策略：\n${strategies.slice(0, 20).map((strategy) => `- ${strategy.statement}`).join("\n")}\n这些策略只作为默认参考；如果本项目的明确要求与其冲突，以本项目为准。`;
}

export function combineCreatorPrompts(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n\n");
}
