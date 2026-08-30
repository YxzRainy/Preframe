"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  Check,
  CheckCircle,
  CaretDown,
  Pause,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import type { CreatorLearningSummary, CreatorStrategy, LearningFact, LearningPattern } from "../../../src/types/creatorLearning";
import { readJsonResponse } from "../../lib/readJsonResponse";

const CATEGORY_LABELS: Record<string, string> = {
  script: "脚本",
  shooting: "拍摄",
  visual: "画面",
  workflow: "流程",
  audience: "受众",
  publishing: "发布",
  performance: "数据",
};

type NextAction = { label: string; description: string; target?: string; scan?: boolean };

function getNextAction(learning: CreatorLearningSummary): NextAction {
  if (!learning.lastScannedAt) return { label: "开始复盘", description: "先从已完成项目中找出值得保留或避免的做法。", scan: true };
  if (learning.counts.pendingFacts) return { label: "确认这次发生了什么", description: `有 ${learning.counts.pendingFacts} 条复盘等待你判断是否真实发生。`, target: "learning-facts" };
  if (learning.counts.candidatePatterns) return { label: "决定哪些经验值得复用", description: `有 ${learning.counts.candidatePatterns} 条跨项目经验等待你采用。`, target: "learning-patterns" };
  if (learning.counts.activeStrategies) return { label: "查看正在使用的策略", description: "这些经验会作为新项目的参考，可随时暂停。", target: "learning-strategies" };
  return { label: "重新检查复盘", description: "新完成项目后，可再次检查有没有可学习的经验。", scan: true };
}

function formatScannedAt(value?: string): string {
  if (!value) return "尚未检查";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚检查";
  return `上次检查：${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function CreatorLearningPanel() {
  const [learning, setLearning] = useState<CreatorLearningSummary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/creator-learning", { cache: "no-store" });
    const data = await readJsonResponse<{ learning?: CreatorLearningSummary; error?: string }>(response);
    if (!response.ok || !data.learning) throw new Error(data.error || "创作者学习读取失败。");
    setLearning(data.learning);
  }, []);

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "创作者学习读取失败。"));
  }, [load]);

  async function post(body: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setError(""); setMessage("");
    try {
      const response = await fetch("/api/creator-learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await readJsonResponse<{ learning?: CreatorLearningSummary; error?: string }>(response);
      if (!response.ok || !data.learning) throw new Error(data.error || "创作者学习更新失败。");
      setLearning(data.learning); setMessage(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创作者学习更新失败。");
    } finally { setBusy(""); }
  }

  const pendingFacts = useMemo(() => learning?.facts.filter((fact) => fact.status === "pending") || [], [learning]);
  const candidatePatterns = useMemo(() => learning?.patterns.filter((pattern) => pattern.status === "candidate") || [], [learning]);
  const strategies = learning?.strategies || [];
  const nextAction = learning ? getNextAction(learning) : null;
  const factsById = useMemo(() => new Map(learning?.facts.map((fact) => [fact.id, fact]) || []), [learning]);

  function runNextAction() {
    if (!nextAction) return;
    if (nextAction.scan) { void post({ action: "scan" }, "scan", "复盘已更新。现在只需要确认你认同的内容。"); return; }
    if (nextAction.target) scrollToSection(nextAction.target);
  }

  const itemCount = pendingFacts.length + candidatePatterns.length + strategies.length;

  return <div className="learning-panel learning-panel-compact">
    <section className="learning-toolbar">
      <div><strong>经验库</strong><span>{learning ? `${pendingFacts.length} 条待确认 · ${strategies.filter((item) => item.status === "active").length} 条生效中` : "正在读取…"}</span></div>
      <button type="button" className="secondary-button" disabled={Boolean(busy) || !nextAction} onClick={runNextAction}>
        {nextAction?.scan ? <ArrowClockwise size={15} /> : <ArrowRight size={15} />}{busy === "scan" ? "检查中…" : nextAction?.label || "读取中…"}
      </button>
    </section>

    {message && <p className="learning-feedback" role="status"><CheckCircle size={15} weight="fill" />{message}</p>}
    {error && <p className="settings-modal-error" role="alert">{error}</p>}

    {learning && itemCount === 0 && <div className="learning-empty-compact"><Sparkle size={18} weight="duotone" /><div><strong>还没有可复用经验</strong><span>{formatScannedAt(learning.lastScannedAt)}。完成项目复盘后，再检查一次。</span></div></div>}

    {pendingFacts.length > 0 && <LearningSection id="learning-facts" step="01" title="待确认事实" description="确认真实发生的情况" count={pendingFacts.length} emptyTitle="" empty="">
      {pendingFacts.map((fact) => <FactCard key={fact.id} fact={fact} busy={busy} decide={(decision) => post({ kind: "fact", id: fact.id, decision }, `${fact.id}:${decision}`, decision === "confirm" ? "已加入跨项目比对。" : "已略过。")}/>) }
    </LearningSection>}

    {candidatePatterns.length > 0 && <LearningSection id="learning-patterns" step="02" title="候选经验" description="决定是否用于今后的项目" count={candidatePatterns.length} emptyTitle="" empty="">
      {candidatePatterns.map((pattern) => <PatternCard key={pattern.id} pattern={pattern} factsById={factsById} busy={busy} decide={(decision) => post({ kind: "pattern", id: pattern.id, decision }, `${pattern.id}:${decision}`, decision === "confirm" ? "已采用。" : "暂不采用。")}/>) }
    </LearningSection>}

    {strategies.length > 0 && <LearningSection id="learning-strategies" step="03" title="已采用经验" description="新项目会参考这些经验" count={strategies.length} emptyTitle="" empty="">
      {strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} factsById={factsById} busy={busy} decide={(decision) => post({ kind: "strategy", id: strategy.id, decision }, `${strategy.id}:${decision}`, decision === "retire" ? "已暂停。" : "已恢复。")}/>) }
    </LearningSection>}
  </div>;
}

function LearningSection({ id, step, title, description, count, emptyTitle, empty, children }: { id: string; step: string; title: string; description: string; count: number; emptyTitle: string; empty: string; children: React.ReactNode }) {
  return <section id={id} className="learning-section"><header><span className="learning-section-step">{step}</span><div><h3>{title}</h3><p>{description}</p></div>{count > 0 && <span className="learning-section-count">{count} 条</span>}</header><div className="learning-list">{count ? children : <div className="learning-empty"><Sparkle size={18} weight="duotone" /><strong>{emptyTitle}</strong><span>{empty}</span></div>}</div></section>;
}

function FactCard({ fact, busy, decide }: { fact: LearningFact; busy: string; decide: (decision: "confirm" | "reject") => void }) {
  return <article className="learning-item learning-fact-card"><div className="learning-item-main"><div className="learning-item-meta"><span>{CATEGORY_LABELS[fact.category] || fact.category}</span><span>{fact.sourceProjectName}</span></div><p>{fact.text}</p><small>来源：{fact.sourceType === "shooting" ? "拍摄复盘" : "发布与数据复盘"}</small></div><div className="learning-item-actions"><button type="button" className="learning-confirm-button" disabled={Boolean(busy)} onClick={() => decide("confirm")}><Check size={15} weight="bold" />确认事实</button><button type="button" className="learning-text-button" disabled={Boolean(busy)} onClick={() => decide("reject")}><X size={15} />不纳入学习</button></div></article>;
}

function EvidenceList({ factIds, factsById }: { factIds: string[]; factsById: Map<string, LearningFact> }) {
  const facts = factIds.map((id) => factsById.get(id)).filter((fact): fact is LearningFact => Boolean(fact));
  return <div className="learning-evidence-list">{facts.map((fact) => <div key={fact.id}><span>{fact.sourceProjectName}</span><p>{fact.text}</p></div>)}</div>;
}

function PatternCard({ pattern, factsById, busy, decide }: { pattern: LearningPattern; factsById: Map<string, LearningFact>; busy: string; decide: (decision: "confirm" | "reject") => void }) {
  return <article className="learning-item learning-pattern-card"><div className="learning-pattern-heading"><div className="learning-item-meta"><span>{CATEGORY_LABELS[pattern.category] || pattern.category}</span><span>{pattern.supportingProjectSlugs.length} 个项目支持</span></div><span className="learning-confidence"><CheckCircle size={14} weight="fill" />有跨项目证据</span></div><div className="learning-item-main"><p>{pattern.statement.replace(/^多个项目反复出现[：:]\s*/u, "")}</p><small>采用后，会作为新项目的建议；项目本身的明确要求仍然优先。</small></div><details className="learning-evidence"><summary>查看 {pattern.supportingFactIds.length} 条支持证据 <CaretDown size={15} /></summary><EvidenceList factIds={pattern.supportingFactIds} factsById={factsById} /></details><div className="learning-item-actions"><button type="button" className="learning-confirm-button" disabled={Boolean(busy)} onClick={() => decide("confirm")}><Sparkle size={15} weight="fill" />作为今后参考</button><button type="button" className="learning-text-button" disabled={Boolean(busy)} onClick={() => decide("reject")}><X size={15} />暂不采用</button></div></article>;
}

function StrategyCard({ strategy, factsById, busy, decide }: { strategy: CreatorStrategy; factsById: Map<string, LearningFact>; busy: string; decide: (decision: "retire" | "reactivate") => void }) {
  const isActive = strategy.status === "active";
  return <article className={`learning-item learning-strategy-card ${isActive ? "" : "is-retired"}`}><div className="learning-pattern-heading"><div className="learning-item-meta"><span>{CATEGORY_LABELS[strategy.category] || strategy.category}</span><span>{isActive ? "新项目中生效" : "已暂停"}</span></div><span className={isActive ? "learning-strategy-status" : "learning-strategy-status is-paused"}>{isActive ? <><CheckCircle size={14} weight="fill" />正在参考</> : <><Pause size={14} weight="fill" />不会使用</>}</span></div><div className="learning-item-main"><p>{strategy.statement}</p><small>这是一条建议，不会覆盖项目中已经明确的目标和要求。</small></div><details className="learning-evidence"><summary>查看形成这条经验的 {strategy.supportingFactIds.length} 条事实 <CaretDown size={15} /></summary><EvidenceList factIds={strategy.supportingFactIds} factsById={factsById} /></details><div className="learning-item-actions"><button type="button" className="learning-text-button" disabled={Boolean(busy)} onClick={() => decide(isActive ? "retire" : "reactivate")}>{isActive ? <Pause size={15} /> : <ArrowClockwise size={15} />}{isActive ? "暂停使用" : "恢复使用"}</button></div></article>;
}
