"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brain, GearSix, HardDrives, UserCircle } from "@phosphor-icons/react";
import { AccountMemoryModal } from "../AccountMemoryModal";
import { CreatorProfileModal } from "../CreatorProfileModal";
import { DataMaintenancePanel } from "../DataMaintenancePanel";
import { ModelConfigModal } from "../ModelConfigModal";
import type { WorkspaceState } from "../AppSidebar";
import { readJsonResponse } from "../../lib/readJsonResponse";
import { CreatorLearningPanel } from "./CreatorLearningPanel";

type SettingsTab = "creation" | "model" | "learning" | "storage";

const TABS: readonly { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "creation", label: "创作", icon: <UserCircle size={17} /> },
  { id: "model", label: "模型", icon: <GearSix size={17} /> },
  { id: "learning", label: "学习", icon: <Brain size={17} /> },
  { id: "storage", label: "本地数据", icon: <HardDrives size={17} /> },
];

function normalizeTab(value: string | null): SettingsTab {
  if (value === "model" || value === "learning") return value;
  if (value === "workspace" || value === "maintenance" || value === "storage") return "storage";
  return "creation";
}

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = normalizeTab(searchParams.get("tab"));
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  const loadWorkspace = useCallback(async () => {
    setLoadingWorkspace(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const data = await readJsonResponse<{ workspace?: WorkspaceState; error?: string }>(response);
      if (!response.ok || !data.workspace) throw new Error(data.error || "本地工作区读取失败。");
      setWorkspace(data.workspace);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "本地工作区读取失败。");
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => { if (activeTab === "storage") void loadWorkspace(); }, [activeTab, loadWorkspace]);

  function selectTab(tab: SettingsTab) {
    router.replace(`/settings?tab=${tab}`, { scroll: false });
  }

  async function pickExternalDir() {
    setLoadingWorkspace(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace/pick", { method: "POST" });
      const data = await readJsonResponse<{ workspace?: WorkspaceState; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "文件夹选择失败。");
      if (data.workspace) setWorkspace(data.workspace);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "文件夹选择失败。");
    } finally { setLoadingWorkspace(false); }
  }

  async function restoreDefaultOutputDir() {
    setLoadingWorkspace(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) });
      const data = await readJsonResponse<{ workspace?: WorkspaceState; error?: string }>(response);
      if (!response.ok || !data.workspace) throw new Error(data.error || "输出目录恢复失败。");
      setWorkspace(data.workspace);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "输出目录恢复失败。");
    } finally { setLoadingWorkspace(false); }
  }

  return (
    <main className="settings-page-shell">
      <header className="settings-page-header">
        <div className="settings-page-title-row"><h1>设置</h1></div>
        <nav className="settings-page-nav" aria-label="设置分类">
          {TABS.map((tab) => <button key={tab.id} type="button" className={tab.id === activeTab ? "active" : ""} onClick={() => selectTab(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}
        </nav>
      </header>

      <section className="settings-page-content">
        <div key={activeTab} className="settings-tab-panel">
          {activeTab === "creation" && <>
          <div className="settings-stack">
            <section className="settings-section settings-profile-section"><header><h3>创作者</h3></header><CreatorProfileModal embedded onSaved={() => window.dispatchEvent(new Event("piance-profile-updated"))} /></section>
            <section className="settings-section"><header><h3>默认要求</h3><p>创建新项目时自动参考</p></header><AccountMemoryModal embedded /></section>
          </div>
        </>}

        {activeTab === "model" && <>
          <section className="settings-section settings-model-section"><ModelConfigModal embedded onSaved={(label) => window.dispatchEvent(new CustomEvent("piance-model-config-updated", { detail: { modelLabel: label } }))} /></section>
        </>}

        {activeTab === "learning" && <>
          <CreatorLearningPanel />
        </>}

        {activeTab === "storage" && <>
          <div className="settings-stack">
            <section className="settings-section settings-workspace-section">
              <header><div><h3>项目位置</h3><p>{workspace ? `${workspace.projectCount} 个项目 · ${workspace.totalSizeLabel}` : "本机工作区"}</p></div></header>
              <div className="settings-workspace-row"><code title={workspace?.outputDirAbsolute}>{workspace?.outputDir || (loadingWorkspace ? "读取中…" : "—")}</code><div className="settings-inline-actions"><button type="button" className="secondary-button" onClick={() => void pickExternalDir()} disabled={loadingWorkspace}>更改</button>{workspace?.outputDirAbsolute && !workspace.outputDir.includes("项目内 output") && <button type="button" className="text-button" onClick={() => void restoreDefaultOutputDir()} disabled={loadingWorkspace}>恢复默认</button>}</div></div>
              {workspaceError && <p className="settings-modal-error">{workspaceError}</p>}
            </section>
            <DataMaintenancePanel />
          </div>
        </>}
        </div>
      </section>
    </main>
  );
}
