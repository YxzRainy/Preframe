"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenText, Check, Info, ShieldCheck } from "@phosphor-icons/react";
import { readJsonResponse } from "../lib/readJsonResponse";

type BasisKey = "viewpoints" | "facts" | "drafts" | "boundaries" | "sources";
type Basis = Record<BasisKey, string> & { updatedAt?: string };

const EMPTY: Basis = { viewpoints: "", facts: "", drafts: "", boundaries: "", sources: "" };
const ITEMS: Array<{ key: BasisKey; label: string; prompt: string }> = [
  { key: "viewpoints", label: "观点", prompt: "写下要坚持的判断或立场" },
  { key: "facts", label: "事实", prompt: "记录不可改动的事实、数据或出处" },
  { key: "drafts", label: "已有稿", prompt: "粘贴想保留的段落" },
  { key: "boundaries", label: "禁区", prompt: "写下不要出现的内容" },
  { key: "sources", label: "来源与授权", prompt: "记录事实出处、链接、素材版权、授权范围和需要核实的来源" },
];

type BasisMode = "core" | "risk";

const MODE_KEYS: Record<BasisMode, BasisKey[]> = {
  core: ["viewpoints", "facts", "drafts", "boundaries"],
  risk: ["facts", "sources", "boundaries"],
};

export function ProjectBasisPanel({ slug, mode = "core" }: { slug: string; mode?: BasisMode }) {
  const [basis, setBasis] = useState<Basis>(EMPTY);
  const [active, setActive] = useState<BasisKey>(MODE_KEYS[mode][0]);
  const [state, setState] = useState<"loading" | "saved" | "dirty" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const basisRef = useRef<Basis>(EMPTY);
  const savedRef = useRef(JSON.stringify(EMPTY));

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/basis`, { cache: "no-store" });
      const data = await readJsonResponse<{ basis?: Basis; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "依据包读取失败。");
      const next = { ...EMPTY, ...(data.basis || {}) };
      basisRef.current = next;
      savedRef.current = JSON.stringify(next);
      setBasis(next);
      setState("saved");
    } catch (caught) {
      setState("error");
      setError(caught instanceof Error ? caught.message : "依据包读取失败。");
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActive(MODE_KEYS[mode][0]); }, [mode]);

  const save = useCallback(async () => {
    if (JSON.stringify(basisRef.current) === savedRef.current) return;
    setState("saving"); setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/basis`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basis: basisRef.current }),
      });
      const data = await readJsonResponse<{ basis?: Basis; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "依据包保存失败。");
      const saved = { ...EMPTY, ...(data.basis || basisRef.current) };
      basisRef.current = saved; savedRef.current = JSON.stringify(saved); setBasis(saved); setState("saved");
    } catch (caught) {
      setState("error"); setError(caught instanceof Error ? caught.message : "依据包保存失败。");
    }
  }, [slug]);

  useEffect(() => {
    if (state !== "dirty") return;
    const timer = window.setTimeout(() => { void save(); }, 900);
    return () => window.clearTimeout(timer);
  }, [basis, state, save]);

  const modeItems = ITEMS.filter((entry) => MODE_KEYS[mode].includes(entry.key));
  const item = (modeItems.find((entry) => entry.key === active) || modeItems[0])!;
  const title = mode === "risk" ? "风险与来源" : "创作参考和约束";
  const Icon = mode === "risk" ? ShieldCheck : BookOpenText;
  return (
    <section className={`basis-panel basis-mode-${mode}`} aria-label={title}>
      <header className="basis-panel-header">
        <h2><Icon size={18} weight="fill" /> {title}</h2>
        <span className={`basis-save-state is-${state}`}>{state === "saving" ? "保存中" : state === "dirty" ? "待保存" : state === "error" ? "保存失败" : <><Check size={13} weight="bold" />已保存</>}</span>
      </header>
      <div className="basis-tabs" role="tablist" aria-label="依据类型">
        {modeItems.map((entry) => <button key={entry.key} id={`basis-tab-${entry.key}`} role="tab" aria-controls={`basis-panel-${entry.key}`} aria-selected={active === entry.key} type="button" className={active === entry.key ? "active" : ""} onClick={() => setActive(entry.key)}>{entry.label}</button>)}
      </div>
      <div key={active} id={`basis-panel-${active}`} className="basis-editor" role="tabpanel" aria-labelledby={`basis-tab-${active}`}>
        <label className="sr-only" htmlFor="basis-input">编辑{item.label}</label>
        <textarea id="basis-input" rows={7} value={basis[active]} placeholder={item.prompt} onChange={(event) => {
          const next = { ...basisRef.current, [active]: event.target.value };
          basisRef.current = next; setBasis(next); setState("dirty");
        }} />
      </div>
      {error && <p className="basis-error"><Info size={14} weight="fill" />{error}</p>}
    </section>
  );
}
