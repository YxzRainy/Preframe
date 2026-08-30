"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, FolderSimple, MagnifyingGlass, VideoCamera } from "@phosphor-icons/react";
import { readJsonResponse } from "../lib/readJsonResponse";

interface SearchResult {
  projectSlug: string;
  projectName: string;
  fileName: string;
  snippet: string;
  matchCount: number;
}

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("preframe-open-command-palette", show);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("preframe-open-command-palette", show); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const value = query.trim();
    if (!value) { setResults([]); setState("idle"); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`, { signal: controller.signal, cache: "no-store" });
        const data = await readJsonResponse<{ results?: SearchResult[]; error?: string }>(response);
        if (!response.ok) throw new Error(data.error || "搜索失败。");
        setResults(data.results || []); setState("idle");
      } catch (error) {
        if ((error as Error).name !== "AbortError") { setState("error"); setResults([]); }
      }
    }, 160);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  function close() { setOpen(false); setQuery(""); setResults([]); setState("idle"); }
  function go(url: string) { close(); router.push(url); }

  if (!open) return null;
  return (
    <div className="command-palette-layer" role="presentation">
      <button className="command-palette-backdrop" type="button" aria-label="关闭搜索" onClick={close} />
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="搜索项目内容">
        <div className="command-search-field">
          <MagnifyingGlass size={20} weight="bold" />
          <label className="sr-only" htmlFor="workspace-search">搜索项目文档</label>
          <input id="workspace-search" ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索所有项目与文档…" autoComplete="off" />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results">
          {!query.trim() ? <>
            <p className="command-section-label">快捷操作</p>
            <button type="button" className="command-action" onClick={() => go("/?new=1")}><span><FolderSimple size={18} weight="fill" /></span><div><strong>新建项目</strong><small>从一个选题开始</small></div><ArrowRight size={16} /></button>
            <button type="button" className="command-action" onClick={() => go("/projects")}><span><FileText size={18} weight="fill" /></span><div><strong>浏览项目库</strong><small>查看全部本地项目</small></div><ArrowRight size={16} /></button>
          </> : state === "loading" ? <p className="command-state">正在检索文档内容…</p>
            : state === "error" ? <p className="command-state is-error">暂时无法完成搜索，请稍后重试。</p>
              : results.length ? <><p className="command-section-label">文档结果 · {results.length}</p>{results.map((result) => <button key={`${result.projectSlug}:${result.fileName}`} type="button" className="command-result" onClick={() => go(`/projects/${encodeURIComponent(result.projectSlug)}?document=${encodeURIComponent(result.fileName)}`)}><span><FileText size={17} weight="fill" /></span><div><strong>{result.fileName.replace(/^\d{2}_/u, "")}</strong><small>{result.projectName} · 命中 {result.matchCount} 处</small><p>{result.snippet}</p></div><ArrowRight size={16} /></button>)}</>
                : <p className="command-state">没有找到“{query.trim()}”相关内容。</p>}
        </div>
        <footer><span><kbd>↵</kbd> 打开</span><span><kbd>⌘K</kbd> 随时搜索</span></footer>
      </section>
    </div>
  );
}
