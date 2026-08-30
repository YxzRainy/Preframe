"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brain, Database, GearSix, HardDrives, UserCircle, Waveform } from "@phosphor-icons/react";
import { AccountMemoryModal } from "../AccountMemoryModal";
import { CreatorProfileModal } from "../CreatorProfileModal";
import { DataMaintenancePanel } from "../DataMaintenancePanel";
import { ModelConfigModal } from "../ModelConfigModal";
import type { WorkspaceState } from "../AppSidebar";
import { readJsonResponse } from "../../lib/readJsonResponse";
import { CreatorLearningPanel } from "./CreatorLearningPanel";

type SettingsTab = "model" | "memory" | "learning" | "profile" | "workspace" | "maintenance";

const TABS: readonly { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "model", label: "模型", icon: <GearSix size={18} weight="duotone" /> },
  { id: "memory", label: "创作偏好", icon: <Waveform size={18} weight="duotone" /> },
  { id: "learning", label: "创作者学习", icon: <Brain size={18} weight="duotone" /> },
  { id: "profile", label: "创作者资料", icon: <UserCircle size={18} weight="duotone" /> },
  { id: "workspace", label: "工作区", icon: <HardDrives size={18} weight="duotone" /> },
  { id: "maintenance", label: "数据维护", icon: <Database size={18} weight="duotone" /> },
];

function isSettingsTab(value: string | null): value is SettingsTab {
  return TABS.some((tab) => tab.id === value);
}

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("tab");
  const activeTab: SettingsTab = isSettingsTab(selected) ? selected : "model";
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

  useEffect(() => { if (activeTab === "workspace") void loadWorkspace(); }, [activeTab, loadWorkspace]);

  function selectTab(tab: SettingsTab) {
    router.replace(`/settings?tab=${tab}`, { scroll: false });
  }

  async function pickExternalDir() {
    setLoadingWorkspace(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace/pick", { method: "POST" });
      const data = await readJsonResponse<{ workspace?: WorkspaceState; canceled?: boolean; error?: string }>(response);
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
      <header className="settings-page-header"><h1>设置</h1></header>
      <div className="settings-page-layout">
        <nav className="settings-page-nav" aria-label="设置分类">
          {TABS.map((tab) => <button key={tab.id} type="button" className={tab.id === activeTab ? "active" : ""} onClick={() => selectTab(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}
        </nav>
        <section className="settings-page-content">
          {activeTab === "model" && <><header><h2>模型</h2><p>配置内容生成使用的模型连接。</p></header><ModelConfigModal embedded onSaved={(label) => window.dispatchEvent(new CustomEvent("piance-model-config-updated", { detail: { modelLabel: label } }))} /></>}
          {activeTab === "memory" && <><header><h2>创作偏好</h2><p>作为新项目的默认参考。</p></header><AccountMemoryModal embedded /></>}
          {activeTab === "learning" && <><header><h2>创作者学习</h2><p>把已验证的复盘经验，变成下一次创作的参考。</p></header><CreatorLearningPanel /></>}
          {activeTab === "profile" && <><header><h2>创作者资料</h2><p>本地保存的昵称和头像。</p></header><CreatorProfileModal embedded onSaved={() => window.dispatchEvent(new Event("piance-profile-updated"))} /></>}
          {activeTab === "workspace" && <><header><h2>工作区</h2><p>项目文件保存在这个位置。</p></header><div className="settings-embedded-form settings-workspace-form"><label>输出目录</label><div className="settings-workspace-path">{workspace?.outputDirAbsolute || (loadingWorkspace ? "读取中…" : "—")}</div><div className="settings-inline-actions"><button type="button" className="secondary-button" onClick={() => void pickExternalDir()} disabled={loadingWorkspace}>{loadingWorkspace ? "处理中…" : "更改目录"}</button>{workspace?.outputDirAbsolute && !workspace.outputDir.includes("项目内 output") && <button type="button" className="secondary-button" onClick={() => void restoreDefaultOutputDir()} disabled={loadingWorkspace}>恢复默认目录</button>}</div>{workspaceError && <p className="settings-modal-error">{workspaceError}</p>}</div></>}
          {activeTab === "maintenance" && <><header><h2>数据维护</h2><p>备份、迁移和诊断本地数据。</p></header><DataMaintenancePanel /></>}
        </section>
      </div>
    </main>
  );
}
