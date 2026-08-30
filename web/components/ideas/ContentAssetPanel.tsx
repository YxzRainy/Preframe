"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, ArrowUpRight, Books, MagnifyingGlass, Sparkle } from "@phosphor-icons/react";
import type { ContentAssetAssembly, ContentAssetStore, ContentAssetSuggestion, ContentAtom } from "../../../src/types/contentAsset";
import { readJsonResponse } from "../../lib/readJsonResponse";

const KIND_LABELS: Record<string, string> = {
  viewpoint: "观点",
  case: "案例",
  hook: "开头",
  "audience-question": "受众问题",
  result: "真实结果",
  strategy: "账号策略",
};

export function ContentAssetPanel() {
  const [assets, setAssets] = useState<ContentAssetStore | null>(null);
  const [assembly, setAssembly] = useState<ContentAssetAssembly | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/content-assets", { cache: "no-store" });
    const data = await readJsonResponse<{ assets?: ContentAssetStore; error?: string }>(response);
    if (!response.ok || !data.assets) throw new Error(data.error || "内容资产读取失败。");
    setAssets(data.assets);
  }, []);

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "内容资产读取失败。")); }, [load]);

  async function rebuild() {
    setBusy("rebuild"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/content-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rebuild" }) });
      const data = await readJsonResponse<{ assets?: ContentAssetStore; error?: string }>(response);
      if (!response.ok || !data.assets) throw new Error(data.error || "内容资产整理失败。");
      setAssets(data.assets); setAssembly(null); setMessage("历史项目已经重新整理成可追溯内容单元。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "内容资产整理失败。"); }
    finally { setBusy(""); }
  }

  async function assemble() {
    setBusy("assemble"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/content-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assemble", query }) });
      const data = await readJsonResponse<{ assembly?: ContentAssetAssembly; error?: string }>(response);
      if (!response.ok || !data.assembly) throw new Error(data.error || "历史内容检索失败。");
      setAssembly(data.assembly);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "历史内容检索失败。"); }
    finally { setBusy(""); }
  }

  async function saveSuggestion(suggestion: ContentAssetSuggestion) {
    setBusy(suggestion.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: suggestion.title, note: `${suggestion.note}\n\n装配说明：${suggestion.rationale}`, source: "历史内容资产装配", tags: suggestion.tags }) });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "选题保存失败。");
      setMessage("选题胚子已保存到灵感收件箱。");
      window.dispatchEvent(new Event("piance-ideas-updated"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "选题保存失败。"); }
    finally { setBusy(""); }
  }

  const suggestions = assembly?.suggestions.length ? assembly.suggestions : assets?.suggestions || [];
  const resultAtoms = assembly ? [
    ...assembly.strategies,
    ...assembly.viewpoints,
    ...assembly.audienceQuestions,
    ...assembly.cases,
    ...assembly.hooks,
    ...assembly.results,
  ] : [];

  return <section className="content-assets-panel" aria-label="内容资产">
    <header className="content-assets-head"><div><span className="learning-eyebrow">历史项目复用</span><h2>内容资产</h2><p>保留来源，把旧项目拆成观点、案例、受众问题、开头和真实结果；达到成熟度门槛后再跨项目装配选题。</p></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void rebuild()}><ArrowClockwise size={15} />{busy === "rebuild" ? "整理中…" : "重新整理"}</button></header>

    {assets && <div className={`content-assets-readiness ${assets.readiness.ready ? "is-ready" : ""}`}><Books size={20} weight="duotone" /><div><strong>{assets.readiness.ready ? "内容资产已可用" : "内容资产仍在积累"}</strong><p>{assets.readiness.reason}</p></div><span>{assets.readiness.projectCount} 项目 · {assets.readiness.atomCount} 单元</span></div>}
    {message && <p className="content-assets-message">{message}</p>}
    {error && <p className="idea-error">{error}</p>}

    <form className="content-assets-search" onSubmit={(event) => { event.preventDefault(); void assemble(); }}><MagnifyingGlass size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入一个选题、受众问题或关键词，查找旧项目中可复用的内容"/><button type="submit" disabled={busy === "assemble" || !assets?.atoms.length}>{busy === "assemble" ? "查找中…" : "查找并装配"}</button></form>

    {assets?.topics.length ? <div className="content-topic-map"><div className="content-assets-subhead"><h3>主题地图</h3><span>按来源主题聚合</span></div><div className="content-topic-list">{assets.topics.slice(0, 12).map((topic) => <button type="button" key={topic.id} onClick={() => { setQuery(topic.label); }}><strong>{topic.label}</strong><span>{topic.projectCount} 项目 · {topic.atomCount} 单元</span></button>)}</div></div> : null}

    {assembly && <div className="content-assembly-results"><div className="content-assets-subhead"><h3>可复用材料</h3><span>{assembly.sourceProjects.length} 个来源项目</span></div>{resultAtoms.length ? <div className="content-atom-grid">{resultAtoms.slice(0, 18).map((atom) => <AtomCard atom={atom} key={atom.id}/>)}</div> : <div className="learning-empty">没有找到与这个问题直接相关的历史内容。</div>}</div>}

    <div className="content-suggestions"><div className="content-assets-subhead"><h3>选题装配</h3><span>{assets?.readiness.ready ? "由不同来源重新组合" : "达到成熟度门槛后开放"}</span></div>{suggestions.length ? <div className="content-suggestion-grid">{suggestions.map((suggestion) => <article key={suggestion.id}><Sparkle size={17} weight="duotone"/><h4>{suggestion.title}</h4><p>{suggestion.rationale}</p><div>{suggestion.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><button type="button" disabled={Boolean(busy)} onClick={() => void saveSuggestion(suggestion)}>{busy === suggestion.id ? "保存中…" : "存入灵感"}<ArrowUpRight size={14}/></button></article>)}</div> : <div className="learning-empty">先整理至少 {assets?.readiness.minimumProjects || 3} 个项目；系统不会用少量样本强行总结选题规律。</div>}</div>
  </section>;
}

function AtomCard({ atom }: { atom: ContentAtom }) {
  return <article className="content-atom-card"><div><span>{KIND_LABELS[atom.kind] || atom.kind}</span>{atom.sourceProjectName && <small>{atom.sourceProjectName}</small>}</div><p>{atom.text}</p>{atom.sourceFile && <footer>{atom.sourceFile}{atom.sourceSection ? ` · ${atom.sourceSection}` : ""}</footer>}</article>;
}
