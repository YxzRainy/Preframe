"use client";

import { useCallback, useEffect, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { ContentAssetAssembly, ContentAssetStore, ContentAtom } from "../../../src/types/contentAsset";
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
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/content-assets", { cache: "no-store" });
    const data = await readJsonResponse<{ assets?: ContentAssetStore; error?: string }>(response);
    if (!response.ok || !data.assets) throw new Error(data.error || "内容资产读取失败。");
    setAssets(data.assets);
  }, []);

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "内容资产读取失败。")); }, [load]);

  async function assemble() {
    setSearching(true); setError("");
    try {
      const response = await fetch("/api/content-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assemble", query }) });
      const data = await readJsonResponse<{ assembly?: ContentAssetAssembly; error?: string }>(response);
      if (!response.ok || !data.assembly) throw new Error(data.error || "历史内容检索失败。");
      setAssembly(data.assembly);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "历史内容检索失败。"); }
    finally { setSearching(false); }
  }

  const resultAtoms = assembly ? [
    ...assembly.strategies,
    ...assembly.viewpoints,
    ...assembly.audienceQuestions,
    ...assembly.cases,
    ...assembly.hooks,
    ...assembly.results,
  ] : [];
  const hasSearchableAssets = Boolean(assets?.atoms.length);

  return <section className="content-assets-panel" aria-label="历史内容检索">
    <form className="content-assets-search" onSubmit={(event) => { event.preventDefault(); void assemble(); }}>
      <label htmlFor="content-assets-query">旧内容</label>
      <MagnifyingGlass size={17} aria-hidden="true" />
      <input id="content-assets-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索历史项目中的观点、案例或问题" />
      <button type="submit" disabled={searching || !hasSearchableAssets || !query.trim()}>{searching ? "查找中…" : "查找"}</button>
    </form>
    {error && <p className="idea-error">{error}</p>}
    {assets && !hasSearchableAssets && <p className="content-assets-hint">暂无可检索的历史内容。</p>}
    {assembly && <div className="content-assembly-results"><div className="content-assets-subhead"><h2>相关内容</h2><span>{assembly.sourceProjects.length} 个来源项目</span></div>{resultAtoms.length ? <div className="content-atom-grid">{resultAtoms.slice(0, 12).map((atom) => <AtomCard atom={atom} key={atom.id}/>)}</div> : <p className="content-assets-hint">没有找到直接相关的历史内容。</p>}</div>}
  </section>;
}

function AtomCard({ atom }: { atom: ContentAtom }) {
  return <article className="content-atom-card"><div><span>{KIND_LABELS[atom.kind] || atom.kind}</span>{atom.sourceProjectName && <small>{atom.sourceProjectName}</small>}</div><p>{atom.text}</p>{atom.sourceFile && <footer>{atom.sourceFile}{atom.sourceSection ? ` · ${atom.sourceSection}` : ""}</footer>}</article>;
}
