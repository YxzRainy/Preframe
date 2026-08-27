"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DashboardHeader } from "./DashboardHeader";
import { TodayFocus } from "./TodayFocus";
import { CurrentProjects } from "./CurrentProjects";
import type { DashboardData, DashboardProject, ProjectStage } from "./types";
import { readJsonResponse } from "../../lib/readJsonResponse";

interface DashboardWorkspaceProps {
  initialNowIso: string;
  initialData?: DashboardData;
}

export function DashboardWorkspace({ initialNowIso, initialData }: DashboardWorkspaceProps) {
  const [data, setData] = useState<DashboardData | null>(() => initialData ?? null);
  const [error, setError] = useState("");
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState({ title: "", note: "" });
  const [ideaSaving, setIdeaSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await readJsonResponse<DashboardData & { error?: string }>(response);
      if (!response.ok) throw new Error(json.error || "工作台数据读取失败。");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "工作台数据读取失败。");
    }
  }, []);

  useEffect(() => {
    if (!initialData) load();
  }, [initialData, load]);

  // 推进中阶段优先级：planning → ready_to_shoot → shooting → editing → ready_to_publish → idea
  const focusProject: DashboardProject | undefined = (() => {
    if (!data?.projects.length) return undefined;
    const priority: ProjectStage[] = ["planning", "ready_to_shoot", "shooting", "editing", "ready_to_publish", "idea", "published"];
    for (const stage of priority) {
      const found = data.projects.find((p) => p.stage === stage);
      if (found) return found;
    }
    return data.projects[0];
  })();

  function openCreate() {
    window.dispatchEvent(new Event("piance-open-new-task"));
  }
  function openIdea() { setIdeaOpen(true); }

  async function saveIdea() {
    if (!ideaDraft.title.trim()) return;
    setIdeaSaving(true);
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: ideaDraft.title.trim(), note: ideaDraft.note.trim() || undefined }),
      });
      setIdeaDraft({ title: "", note: "" });
      setIdeaOpen(false);
      window.dispatchEvent(new Event("piance-ideas-updated"));
    } finally {
      setIdeaSaving(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <DashboardHeader initialNowIso={initialNowIso} />

      {error && <div className="dashboard-error">{error}</div>}

      <div className="dashboard-primary-column">
        <TodayFocus project={focusProject} onCreateProject={openCreate} onRecordIdea={openIdea} />
        <CurrentProjects projects={data?.projects || []} />
      </div>

      {ideaOpen && (
        <div className="idea-quick-overlay" role="dialog" aria-modal="true" aria-label="快速记录灵感">
          <button className="idea-quick-backdrop" type="button" onClick={() => setIdeaOpen(false)} />
          <div className="idea-quick-panel">
            <header><h2>记录一个灵感</h2><button type="button" onClick={() => setIdeaOpen(false)}>×</button></header>
            <div className="idea-quick-body">
              <input
                type="text"
                placeholder="一句话写下你的想法…"
                value={ideaDraft.title}
                onChange={(e) => setIdeaDraft((d) => ({ ...d, title: e.target.value }))}
                autoFocus
              />
              <textarea
                placeholder="补充说明（可选）"
                value={ideaDraft.note}
                rows={3}
                onChange={(e) => setIdeaDraft((d) => ({ ...d, note: e.target.value }))}
              />
              <div className="idea-quick-actions">
                <Link href="/ideas">进入灵感</Link>
                <button type="button" className="primary" onClick={saveIdea} disabled={ideaSaving || !ideaDraft.title.trim()}>
                  {ideaSaving ? "保存中…" : "保存灵感"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
