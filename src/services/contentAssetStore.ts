import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { nowIso, readJsonFile, writeJsonFile } from "./localStore.js";
import { listProjects } from "./projectManager.js";
import { getActiveCreatorStrategies } from "./creatorLearningStore.js";
import type {
  ContentAssetAssembly,
  ContentAssetReadiness,
  ContentAssetStore,
  ContentAssetSuggestion,
  ContentAtom,
  ContentAtomKind,
  ContentTopicNode,
} from "../types/contentAsset.js";

const STORE_NAME = "content-assets";
const LEARNING_CATEGORY_LABELS: Record<string, string> = { script: "脚本", shooting: "拍摄", visual: "画面", workflow: "流程", audience: "受众", publishing: "发布", performance: "数据" };
export const CONTENT_ASSET_MIN_PROJECTS = 3;
export const CONTENT_ASSET_MIN_ATOMS = 8;

function emptyReadiness(): ContentAssetReadiness {
  return {
    ready: false,
    projectCount: 0,
    atomCount: 0,
    activeStrategyCount: 0,
    minimumProjects: CONTENT_ASSET_MIN_PROJECTS,
    minimumAtoms: CONTENT_ASSET_MIN_ATOMS,
    reason: `至少需要 ${CONTENT_ASSET_MIN_PROJECTS} 个项目和 ${CONTENT_ASSET_MIN_ATOMS} 个可复用内容单元。`,
  };
}

function emptyStore(): ContentAssetStore {
  return { version: 1, atoms: [], topics: [], suggestions: [], readiness: emptyReadiness() };
}

function cleanText(value: unknown, limit = 420): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").replace(/^[-*]\s*/u, "").trim().slice(0, limit) : "";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function section(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return content.match(new RegExp(`(?:^|\\n)##\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u"))?.[1]?.trim() || "";
}

function meaningfulLines(content: string, max = 8): string[] {
  const lines = content
    .split("\n")
    .map((line) => cleanText(line.replace(/^#{1,6}\s+/u, "")))
    .filter((line) => line.length >= 8 && line.length <= 260)
    .filter((line) => !/^\|?\s*[-:]+/u.test(line))
    .filter((line) => !/待确认|发布后填写|人工确认|无$/u.test(line));
  return [...new Set(lines)].slice(0, max);
}

function firstSpokenSentences(content: string): string[] {
  const script = section(content, "最终逐字口播稿") || section(content, "最终逐字稿") || content;
  return script
    .replace(/^#{1,6}.*$/gmu, "")
    .split(/[。！？\n]+/u)
    .map((item) => cleanText(item, 180))
    .filter((item) => item.length >= 8)
    .slice(0, 2);
}

function casesFromScript(content: string): string[] {
  const script = section(content, "最终逐字口播稿") || section(content, "最终逐字稿") || "";
  return script
    .split(/\n{2,}|(?<=[。！？])/u)
    .map((item) => cleanText(item, 300))
    .filter((item) => item.length >= 18 && /比如|例如|案例|有一次|一个客户|我曾|当时|后来/u.test(item))
    .slice(0, 5);
}

function resultLines(content: string): string[] {
  const record = section(content, "发布记录");
  const review = section(content, "数据复盘");
  return meaningfulLines(`${record}\n${review}`, 12)
    .filter((line) => !/发布后填写|待填写|暂无/u.test(line))
    .filter((line) => !/计划|目标|预计|建议|阈值|待决定|待执行/u.test(line))
    .filter((line) => /\d|https?:\/\/|已发布|已上线|已完成|不适用/u.test(line));
}

function topicTokens(topic: string): string[] {
  const cleaned = cleanText(topic, 120);
  if (!cleaned) return [];
  const parts = cleaned.split(/[，。！？、：:；;（）()\s/]+/u).filter((item) => item.length >= 2 && item.length <= 16);
  return [...new Set([cleaned, ...parts])].slice(0, 6);
}

function createAtom(args: {
  kind: ContentAtomKind;
  text: string;
  projectSlug?: string;
  projectName?: string;
  file?: string;
  section?: string;
  platform?: string;
  domain?: string;
  tags?: string[];
  old?: ContentAtom;
}): ContentAtom | null {
  const text = cleanText(args.text);
  if (text.length < 8) return null;
  const fingerprint = hash([args.kind, args.projectSlug || "global", args.file || "", args.section || "", normalize(text)].join("|"));
  const now = nowIso();
  return {
    id: args.old?.id || `atom_${fingerprint}`,
    fingerprint,
    kind: args.kind,
    text,
    ...(args.projectSlug ? { sourceProjectSlug: args.projectSlug } : {}),
    ...(args.projectName ? { sourceProjectName: args.projectName } : {}),
    ...(args.file ? { sourceFile: args.file } : {}),
    ...(args.section ? { sourceSection: args.section } : {}),
    ...(args.platform ? { platform: args.platform } : {}),
    ...(args.domain ? { domain: args.domain } : {}),
    tags: [...new Set((args.tags || []).map((tag) => cleanText(tag, 40)).filter(Boolean))],
    createdAt: args.old?.createdAt || now,
    updatedAt: now,
  };
}

export function extractProjectAtoms(args: {
  slug: string;
  name: string;
  topic: string;
  platform: string;
  domain: string;
  creativeBrief: string;
  shootingExecution: string;
  publishReview: string;
  previous?: ContentAtom[];
}): ContentAtom[] {
  const previous = new Map((args.previous || []).map((atom) => [atom.fingerprint, atom]));
  const tags = [...new Set([args.platform, args.domain, ...topicTokens(args.topic)].filter(Boolean))];
  const drafts: Array<Omit<Parameters<typeof createAtom>[0], "old">> = [];
  meaningfulLines(section(args.creativeBrief, "核心观点"), 6).forEach((text) => drafts.push({ kind: "viewpoint", text, projectSlug: args.slug, projectName: args.name, file: "01_创作简报.md", section: "核心观点", platform: args.platform, domain: args.domain, tags }));
  meaningfulLines(section(args.creativeBrief, "目标与用户"), 5).forEach((text) => drafts.push({ kind: "audience-question", text, projectSlug: args.slug, projectName: args.name, file: "01_创作简报.md", section: "目标与用户", platform: args.platform, domain: args.domain, tags }));
  firstSpokenSentences(args.shootingExecution).forEach((text) => drafts.push({ kind: "hook", text, projectSlug: args.slug, projectName: args.name, file: "02_拍摄执行稿.md", section: "最终逐字口播稿", platform: args.platform, domain: args.domain, tags }));
  casesFromScript(args.shootingExecution).forEach((text) => drafts.push({ kind: "case", text, projectSlug: args.slug, projectName: args.name, file: "02_拍摄执行稿.md", section: "最终逐字口播稿", platform: args.platform, domain: args.domain, tags }));
  resultLines(args.publishReview).forEach((text) => drafts.push({ kind: "result", text, projectSlug: args.slug, projectName: args.name, file: "03_发布与复盘.md", section: "数据复盘", platform: args.platform, domain: args.domain, tags }));

  return drafts.map((draft) => {
    const text = cleanText(draft.text);
    const fingerprint = hash([draft.kind, draft.projectSlug || "global", draft.file || "", draft.section || "", normalize(text)].join("|"));
    return createAtom({ ...draft, old: previous.get(fingerprint) });
  }).filter((atom): atom is ContentAtom => atom !== null);
}

export function buildTopicMap(atoms: ContentAtom[]): ContentTopicNode[] {
  const map = new Map<string, { atoms: ContentAtom[]; projects: Set<string> }>();
  for (const atom of atoms) {
    const labels = [...new Set([atom.domain, ...atom.tags].filter((tag): tag is string => Boolean(tag && tag.length >= 2 && tag.length <= 40)))];
    for (const label of labels) {
      const key = normalize(label);
      if (!key) continue;
      const current = map.get(key) || { atoms: [], projects: new Set<string>() };
      current.atoms.push(atom);
      if (atom.sourceProjectSlug) current.projects.add(atom.sourceProjectSlug);
      map.set(key, current);
    }
  }
  return [...map.entries()].map(([key, value]) => {
    const kinds: ContentTopicNode["kinds"] = {};
    value.atoms.forEach((atom) => { kinds[atom.kind] = (kinds[atom.kind] || 0) + 1; });
    const label = value.atoms.flatMap((atom) => [atom.domain, ...atom.tags]).find((tag) => tag && normalize(tag) === key) || key;
    return {
      id: `topic_${hash(key)}`,
      label,
      atomCount: value.atoms.length,
      projectCount: value.projects.size,
      projectSlugs: [...value.projects],
      kinds,
    };
  }).sort((a, b) => b.projectCount - a.projectCount || b.atomCount - a.atomCount || a.label.localeCompare(b.label, "zh-CN")).slice(0, 24);
}

function queryTerms(query: string): string[] {
  const normalized = cleanText(query, 200).toLocaleLowerCase("zh-CN");
  return [...new Set([normalized, ...normalized.split(/[，。！？、：:；;（）()\s/]+/u)].filter((item) => item.length >= 2))];
}

export function rankContentAtoms(atoms: ContentAtom[], query: string, limit = 40): ContentAtom[] {
  const terms = queryTerms(query);
  if (!terms.length) return [...atoms].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, limit);
  return atoms.map((atom) => {
    const haystack = [atom.text, atom.platform, atom.domain, ...atom.tags].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += term === terms[0] ? 8 : 3;
      if (atom.tags.some((tag) => tag.toLocaleLowerCase("zh-CN").includes(term))) score += 4;
    }
    if (atom.kind === "strategy") score += 1;
    return { atom, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || Date.parse(b.atom.updatedAt) - Date.parse(a.atom.updatedAt)).slice(0, limit).map((entry) => entry.atom);
}

function short(value: string, limit = 46): string {
  const text = cleanText(value, limit + 10);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function buildAssetSuggestions(atoms: ContentAtom[], ready: boolean): ContentAssetSuggestion[] {
  if (!ready) return [];
  const viewpoints = atoms.filter((atom) => atom.kind === "viewpoint");
  const questions = atoms.filter((atom) => atom.kind === "audience-question");
  const cases = atoms.filter((atom) => atom.kind === "case");
  const hooks = atoms.filter((atom) => atom.kind === "hook");
  const suggestions: ContentAssetSuggestion[] = [];
  const pairs = Math.min(6, Math.max(viewpoints.length, questions.length, cases.length));
  for (let index = 0; index < pairs; index += 1) {
    const viewpoint = viewpoints[index % Math.max(1, viewpoints.length)];
    const question = questions[(index + 1) % Math.max(1, questions.length)];
    const example = cases[(index + 2) % Math.max(1, cases.length)];
    const hook = hooks[index % Math.max(1, hooks.length)];
    const sourceAtomIds = [viewpoint?.id, question?.id, example?.id, hook?.id].filter((id): id is string => Boolean(id));
    if (!sourceAtomIds.length) continue;
    const title = viewpoint && question
      ? `用“${short(viewpoint.text, 28)}”回答“${short(question.text, 28)}”`
      : viewpoint && example
        ? `用真实案例重新验证：${short(viewpoint.text, 38)}`
        : `复用历史内容资产：${short((viewpoint || question || example || hook)!.text, 42)}`;
    suggestions.push({
      id: `suggestion_${hash(sourceAtomIds.join("|"))}`,
      title,
      note: [
        viewpoint ? `核心观点：${viewpoint.text}` : "",
        question ? `受众问题：${question.text}` : "",
        example ? `可用案例：${example.text}` : "",
        hook ? `可参考开头：${hook.text}` : "",
      ].filter(Boolean).join("\n"),
      tags: [...new Set([...(viewpoint?.tags || []), ...(question?.tags || [])])].slice(0, 5),
      rationale: "由不同历史项目中的观点、受众问题、案例或开头重新装配；它是选题胚子，不代表已验证结论。",
      sourceAtomIds,
    });
  }
  return [...new Map(suggestions.map((item) => [item.id, item])).values()].slice(0, 8);
}

function readiness(projectCount: number, atomCount: number, activeStrategyCount: number): ContentAssetReadiness {
  const ready = projectCount >= CONTENT_ASSET_MIN_PROJECTS && atomCount >= CONTENT_ASSET_MIN_ATOMS;
  return {
    ready,
    projectCount,
    atomCount,
    activeStrategyCount,
    minimumProjects: CONTENT_ASSET_MIN_PROJECTS,
    minimumAtoms: CONTENT_ASSET_MIN_ATOMS,
    reason: ready
      ? `已从 ${projectCount} 个项目整理出 ${atomCount} 个可追溯内容单元。`
      : `当前有 ${projectCount}/${CONTENT_ASSET_MIN_PROJECTS} 个项目、${atomCount}/${CONTENT_ASSET_MIN_ATOMS} 个内容单元；达到门槛后才生成跨项目选题装配。`,
  };
}

async function loadStore(): Promise<ContentAssetStore> {
  const stored = await readJsonFile<ContentAssetStore>(STORE_NAME, emptyStore());
  return {
    version: 1,
    atoms: Array.isArray(stored.atoms) ? stored.atoms : [],
    topics: Array.isArray(stored.topics) ? stored.topics : [],
    suggestions: Array.isArray(stored.suggestions) ? stored.suggestions : [],
    readiness: stored.readiness || emptyReadiness(),
    ...(typeof stored.lastBuiltAt === "string" ? { lastBuiltAt: stored.lastBuiltAt } : {}),
  };
}

export async function getContentAssetStore(): Promise<ContentAssetStore> {
  return loadStore();
}

export async function rebuildContentAssets(): Promise<ContentAssetStore> {
  const [projects, old, strategies] = await Promise.all([listProjects(), loadStore(), getActiveCreatorStrategies()]);
  const oldByProject = new Map<string, ContentAtom[]>();
  old.atoms.forEach((atom) => {
    if (!atom.sourceProjectSlug) return;
    const list = oldByProject.get(atom.sourceProjectSlug) || [];
    list.push(atom);
    oldByProject.set(atom.sourceProjectSlug, list);
  });
  const atoms: ContentAtom[] = [];
  const indexedProjects = new Set<string>();
  for (const project of projects) {
    const metadata = await readFile(path.join(project.path, "project.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => ({} as Record<string, unknown>));
    const name = typeof metadata.projectName === "string" && metadata.projectName.trim() ? metadata.projectName : typeof metadata.topic === "string" && metadata.topic.trim() ? metadata.topic : project.name;
    const topic = typeof metadata.topic === "string" ? metadata.topic : name;
    const platform = typeof metadata.platform === "string" ? metadata.platform : "";
    const domain = typeof metadata.contentDomain === "string" ? metadata.contentDomain : "";
    const [creativeBrief, shootingExecution, publishReview] = await Promise.all([
      readFile(path.join(project.path, "01_创作简报.md"), "utf8").catch(() => ""),
      readFile(path.join(project.path, "02_拍摄执行稿.md"), "utf8").catch(() => ""),
      readFile(path.join(project.path, "03_发布与复盘.md"), "utf8").catch(() => ""),
    ]);
    const projectAtoms = extractProjectAtoms({ slug: project.name, name, topic, platform, domain, creativeBrief, shootingExecution, publishReview, previous: oldByProject.get(project.name) });
    if (projectAtoms.length) indexedProjects.add(project.name);
    atoms.push(...projectAtoms);
  }
  for (const strategy of strategies) {
    const oldStrategy = old.atoms.find((atom) => atom.kind === "strategy" && atom.fingerprint === hash(["strategy", strategy.id, normalize(strategy.statement)].join("|")));
    const atom = createAtom({ kind: "strategy", text: strategy.statement, section: "已确认账号策略", tags: [LEARNING_CATEGORY_LABELS[strategy.category] || strategy.category], old: oldStrategy });
    if (atom) {
      atom.fingerprint = hash(["strategy", strategy.id, normalize(strategy.statement)].join("|"));
      atom.id = oldStrategy?.id || `atom_${atom.fingerprint}`;
      atoms.push(atom);
    }
  }
  const state = readiness(indexedProjects.size, atoms.length, strategies.length);
  const topics = buildTopicMap(atoms);
  const suggestions = buildAssetSuggestions(atoms, state.ready);
  const store: ContentAssetStore = { version: 1, atoms, topics, suggestions, readiness: state, lastBuiltAt: nowIso() };
  await writeJsonFile(STORE_NAME, store);
  return store;
}

export async function assembleContentAssets(query: string): Promise<ContentAssetAssembly> {
  const store = await loadStore();
  const ranked = rankContentAtoms(store.atoms, query, 60);
  const take = (kind: ContentAtomKind, count: number) => ranked.filter((atom) => atom.kind === kind).slice(0, count);
  const selected = ranked.slice(0, 24);
  const projectMap = new Map<string, string>();
  selected.forEach((atom) => { if (atom.sourceProjectSlug) projectMap.set(atom.sourceProjectSlug, atom.sourceProjectName || atom.sourceProjectSlug); });
  return {
    query: cleanText(query, 200),
    viewpoints: take("viewpoint", 6),
    cases: take("case", 5),
    hooks: take("hook", 5),
    audienceQuestions: take("audience-question", 5),
    results: take("result", 5),
    strategies: take("strategy", 8),
    sourceProjects: [...projectMap].map(([slug, name]) => ({ slug, name })),
    suggestions: buildAssetSuggestions(selected, store.readiness.ready),
  };
}

export async function contentAssetPromptForTopic(query: string): Promise<string> {
  const store = await loadStore();
  if (!store.readiness.ready) return "";
  const assembly = await assembleContentAssets(query);
  const lines = [
    ...assembly.strategies.slice(0, 3).map((atom) => `- 已确认策略：${atom.text}`),
    ...assembly.viewpoints.slice(0, 3).map((atom) => `- 历史观点（来自“${atom.sourceProjectName || atom.sourceProjectSlug}”）：${atom.text}`),
    ...assembly.cases.slice(0, 2).map((atom) => `- 历史案例素材（来自“${atom.sourceProjectName || atom.sourceProjectSlug}”）：${atom.text}`),
    ...assembly.hooks.slice(0, 2).map((atom) => `- 历史开头形式（来自“${atom.sourceProjectName || atom.sourceProjectSlug}”）：${atom.text}`),
  ];
  if (!lines.length) return "";
  return `历史内容资产参考：\n${lines.join("\n")}\n只借鉴结构和已经明确标注的来源。历史项目中的模型文案不能自动当作本项目事实；不相关时直接忽略。`;
}
