"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  Brain,
  Check,
  CheckCircle,
  CaretDown,
  Lightning,
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

  return <div className="learning-panel">
    <section className="learning-hero" aria-labelledby="learning-hero-title">
      <div className="learning-hero-copy">
        <span className="learning-eyebrow"><Brain size={14} weight="fill" /> 创作经验库</span>
        <h3 id="learning-hero-title">让每次复盘，帮到下一次创作。</h3>
        <p>系统只提出候选经验；是否真实、是否值得复用，都由你决定。被采用的经验只作为新项目的参考，不会替你做决定。</p>
      </div>
      <div className="learning-hero-action">
        <span>{learning ? formatScannedAt(learning.lastScannedAt) : "正在读取复盘"}</span>
        <button type="button" className="primary-button" disabled={Boolean(busy) || !nextAction} onClick={runNextAction}>
          {nextAction?.scan ? <ArrowClockwise size={16} /> : <ArrowRight size={16} />}{busy === "scan" ? "检查中…" : nextAction?.label || "准备中…"}
        </button>
      </div>
    </section>

    {learning && nextAction && <section className="learning-now" aria-label="当前要做的事"><span className="learning-now-icon"><Lightning size={16} weight="fill" /></span><div><strong>现在：{nextAction.label}</strong><p>{nextAction.description}</p></div></section>}
    {learning && <LearningPath learning={learning} />}
    {message && <p className="learning-feedback" role="status"><CheckCircle size={15} weight="fill" />{message}</p>}
    {error && <p className="settings-modal-error" role="alert">{error}</p>}

    <LearningSection id="learning-facts" step="01" title="先确认：这次到底发生了什么" description="这里是项目里记录的现场问题和真实发布数据。确认它，只代表事实无误；还不会影响以后项目。" count={pendingFacts.length} emptyTitle="先开始一次复盘" empty="系统会从已有的拍摄记录和发布复盘中找出候选事实。">
      {pendingFacts.map((fact) => <FactCard key={fact.id} fact={fact} busy={busy} decide={(decision) => post({ kind: "fact", id: fact.id, decision }, `${fact.id}:${decision}`, decision === "confirm" ? "已确认：这条复盘会进入跨项目比对。" : "已略过：这条内容不会参与后续学习。")}/>) }
    </LearningSection>

    <LearningSection id="learning-patterns" step="02" title="再决定：这条经验要不要复用" description="只有来自至少两个不同项目的已确认事实，才会出现在这里。你可以查看证据，再决定是否把它作为今后的参考。" count={candidatePatterns.length} emptyTitle="还没有可采用的经验" empty="确认更多来自不同项目的事实后，系统会把重复出现的做法带到这里。">
      {candidatePatterns.map((pattern) => <PatternCard key={pattern.id} pattern={pattern} factsById={factsById} busy={busy} decide={(decision) => post({ kind: "pattern", id: pattern.id, decision }, `${pattern.id}:${decision}`, decision === "confirm" ? "已采用：它会作为新项目的创作参考。" : "已暂不采用：这条经验不会影响新项目。")}/>) }
    </LearningSection>

    <LearningSection id="learning-strategies" step="03" title="正在影响新项目的创作经验" description="这是你已经采用的经验库。它们会被带入新项目作为参考；遇到不适用的方向，随时暂停即可。" count={strategies.length} emptyTitle="你的创作经验库还是空的" empty="当你采用一条跨项目经验后，它会出现在这里，并在新项目中提供参考。">
      {strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} factsById={factsById} busy={busy} decide={(decision) => post({ kind: "strategy", id: strategy.id, decision }, `${strategy.id}:${decision}`, decision === "retire" ? "已暂停：新项目不再参考这条经验。" : "已恢复：新项目会再次参考这条经验。")}/>) }
    </LearningSection>
  </div>;
}

function LearningPath({ learning }: { learning: CreatorLearningSummary }) {
  const stages = [
    { number: "01", title: "确认事实", detail: learning.counts.pendingFacts ? `${learning.counts.pendingFacts} 条待处理` : learning.counts.confirmedFacts ? `${learning.counts.confirmedFacts} 条已确认` : "等待复盘", active: Boolean(learning.counts.pendingFacts), complete: !learning.counts.pendingFacts && learning.counts.confirmedFacts > 0 },
    { number: "02", title: "采用经验", detail: learning.counts.candidatePatterns ? `${learning.counts.candidatePatterns} 条待决定` : "跨项目比对", active: !learning.counts.pendingFacts && Boolean(learning.counts.candidatePatterns), complete: !learning.counts.pendingFacts && !learning.counts.candidatePatterns && learning.counts.activeStrategies > 0 },
    { number: "03", title: "用于新项目", detail: learning.counts.activeStrategies ? `${learning.counts.activeStrategies} 条正在使用` : "等待采用", active: !learning.counts.pendingFacts && !learning.counts.candidatePatterns && Boolean(learning.counts.activeStrategies), complete: false },
  ];
  return <ol className="learning-path" aria-label="创作者学习流程">{stages.map((stage) => <li key={stage.number} className={`${stage.active ? "is-active" : ""} ${stage.complete ? "is-complete" : ""}`}><span className="learning-path-index">{stage.complete ? <Check size={13} weight="bold" /> : stage.number}</span><div><strong>{stage.title}</strong><small>{stage.detail}</small></div></li>)}</ol>;
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
