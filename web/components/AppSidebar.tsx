"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  CheckSquare,
  Database,
  FolderOpen,
  GearSix,
  HardDrives,
  House,
  Lightbulb,
  MoonStars,
  PaperPlaneTilt,
  Plus,
  UserCircle,
  Waveform,
} from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { ModelConfigModal } from "./ModelConfigModal";
import { AccountMemoryModal } from "./AccountMemoryModal";
import { CreatorProfileModal } from "./CreatorProfileModal";
import { DataMaintenancePanel } from "./DataMaintenancePanel";
import { readJsonResponse } from "../lib/readJsonResponse";

export interface WorkspaceState {
  outputDir: string;
  outputDirAbsolute?: string;
  projectCount: number;
  totalSizeBytes: number;
  totalSizeLabel: string;
  currentProjectName: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "工作台", icon: <House size={19} weight="duotone" /> },
  { href: "/projects", label: "项目库", icon: <FolderOpen size={19} weight="duotone" /> },
  { href: "/publish", label: "发布中心", icon: <PaperPlaneTilt size={19} weight="duotone" /> },
  { href: "/ideas", label: "灵感", icon: <Lightbulb size={19} weight="duotone" /> },
  { href: "/tasks", label: "待办", icon: <CheckSquare size={19} weight="duotone" /> },
];

type SettingsTab = "model" | "memory" | "profile" | "workspace" | "maintenance" | "appearance";

const SETTINGS_TABS: readonly { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "model", label: "模型", icon: <GearSix size={17} /> },
  { id: "memory", label: "创作偏好", icon: <Waveform size={17} /> },
  { id: "profile", label: "创作者资料", icon: <UserCircle size={17} /> },
  { id: "workspace", label: "工作区", icon: <HardDrives size={17} /> },
  { id: "maintenance", label: "数据维护", icon: <Database size={17} /> },
  { id: "appearance", label: "外观", icon: <MoonStars size={17} /> },
];

interface AppSidebarProps {
  initialWorkspace: WorkspaceState;
}

export function AppSidebar({ initialWorkspace }: AppSidebarProps) {
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => initialWorkspace);
  const [currentProjectName, setCurrentProjectName] = useState(() => initialWorkspace.currentProjectName || "未创建");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [savingOutputDir, setSavingOutputDir] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [settingsCenterOpen, setSettingsCenterOpen] = useState(false);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [accountMemoryOpen, setAccountMemoryOpen] = useState(false);
  const [creatorProfileOpen, setCreatorProfileOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("model");

  const loadWorkspace = useCallback(async (projectName = currentProjectName) => {
    const response = await fetch("/api/workspace");
    const data = await readJsonResponse<{ workspace: WorkspaceState; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "本地工作区读取失败。");
    const next = data.workspace as WorkspaceState;
    setWorkspace({ ...next, currentProjectName: projectName });
  }, [currentProjectName]);

  useEffect(() => {
    const openSidebar = () => setMobileOpen(true);
    window.addEventListener("piance-open-sidebar", openSidebar);
    return () => window.removeEventListener("piance-open-sidebar", openSidebar);
  }, []);

  useEffect(() => {
    const openModelConfig = () => {
      setMobileOpen(false);
      setSettingsCenterOpen(false);
      setModelConfigOpen(true);
    };
    window.addEventListener("piance-open-model-config", openModelConfig);
    return () => window.removeEventListener("piance-open-model-config", openModelConfig);
  }, []);

  useEffect(() => {
    const openAccountMemory = () => {
      setMobileOpen(false);
      setSettingsCenterOpen(false);
      setAccountMemoryOpen(true);
    };
    window.addEventListener("piance-open-account-memory", openAccountMemory);
    return () => window.removeEventListener("piance-open-account-memory", openAccountMemory);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!pathname.startsWith("/projects/")) {
      if (pathname === "/") setCurrentProjectName((current) => current || "未创建");
      return;
    }
    const slug = pathname.split("/").filter(Boolean).at(-1);
    if (!slug) return;
    fetch(`/api/projects/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const data = await readJsonResponse<{ project?: { name?: string }; error?: string }>(response);
        if (!response.ok) throw new Error(data.error || "项目读取失败。");
        const name = typeof data.project?.name === "string" ? data.project.name : "未创建";
        setCurrentProjectName(name);
        setWorkspace((current) => ({ ...current, currentProjectName: name }));
      })
      .catch(() => undefined);
  }, [pathname]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectName?: string }>).detail;
      const name = detail?.projectName?.trim() || "未创建";
      setCurrentProjectName(name);
      loadWorkspace(name).catch(() => undefined);
    };
    window.addEventListener("piance-current-project", handler);
    return () => window.removeEventListener("piance-current-project", handler);
  }, [loadWorkspace]);

  const activePath = useMemo(() => {
    if (pathname === "/" ) return "/";
    if (pathname === "/publish" || pathname.startsWith("/publish/")) return "/publish";
    if (pathname === "/ideas" || pathname.startsWith("/ideas/")) return "/ideas";
    if (pathname === "/tasks" || pathname.startsWith("/tasks/")) return "/tasks";
    if (pathname === "/projects" || pathname.startsWith("/projects/")) return "/projects";
    return "/";
  }, [pathname]);

  function createProject() {
    setMobileOpen(false);
    window.dispatchEvent(new Event("piance-open-new-task"));
  }

  function savedModelConfig(label: string) {
    window.dispatchEvent(new CustomEvent("piance-model-config-updated", { detail: { modelLabel: label } }));
  }

  async function pickExternalDir() {
    setSavingOutputDir(true); setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace/pick", { method: "POST" });
      const data = await readJsonResponse<{ workspace?: WorkspaceState; canceled?: boolean; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "文件夹选择失败。");
      if (data.canceled) return;
      const next = data.workspace as WorkspaceState;
      setWorkspace({ ...next, currentProjectName });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "文件夹选择失败。");
    } finally {
      setSavingOutputDir(false);
    }
  }

  async function restoreDefaultOutputDir() {
    setSavingOutputDir(true); setWorkspaceError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await readJsonResponse<{ workspace: WorkspaceState; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "输出目录恢复失败。");
      const next = data.workspace as WorkspaceState;
      setWorkspace({ ...next, currentProjectName });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "输出目录恢复失败。");
    } finally {
      setSavingOutputDir(false);
    }
  }

  return (
    <>
    <button className={`mobile-sidebar-backdrop ${mobileOpen ? "open" : ""}`} type="button" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} />
    <aside className={`app-sidebar ${mobileOpen ? "open" : ""}`}>
      <div className="app-sidebar-brand">
        <span className="app-sidebar-logo"><img src="/brand-icon.png" alt="片策" /></span>
        <div><strong>片策</strong><small>PREFRAME STUDIO</small></div>
      </div>

      <button className="sidebar-create-button create-project-entry" type="button" onClick={createProject}><Plus size={18} weight="bold" />新建项目</button>

      <nav className="app-nav" aria-label="片策导航">
        {NAV_ITEMS.map((item) => (
          <Link className={activePath === item.href ? "active" : ""} href={item.href} onClick={() => setMobileOpen(false)} key={item.label}><span>{item.icon}</span>{item.label}<i /></Link>
        ))}
        <button type="button" className={settingsCenterOpen ? "active" : ""} title="设置" onClick={() => { setMobileOpen(false); setSettingsCenterOpen(true); }}><span><GearSix size={19} weight="duotone" /></span>设置<i /></button>
      </nav>

      <section className="workspace-card">
        <header>
          <div><HardDrives size={16} /><h2>本地空间</h2></div>
          <span>{workspace.projectCount} 个项目</span>
        </header>
        <p title={currentProjectName}>{currentProjectName === "未创建" ? workspace.totalSizeLabel : currentProjectName}</p>
        {workspaceError && <p className="workspace-error">{workspaceError}</p>}
      </section>
    </aside>
    <Modal
      open={settingsCenterOpen}
      title="设置中心"
      onClose={() => setSettingsCenterOpen(false)}
      size="xl"
    >
      <div className="settings-panel">
        <nav className="settings-panel-nav" aria-label="设置分类">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={settingsTab === tab.id ? "active" : ""}
              onClick={() => setSettingsTab(tab.id)}
            >
              <span>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </nav>
        <div className="settings-panel-content">
          {settingsTab === "model" && (
            <div className="settings-section">
              <h3>模型配置</h3>
              <p className="settings-section-desc">生成模型与连接参数，影响内容生成的质量与速度。</p>
              <button type="button" className="settings-section-action" onClick={() => { setSettingsCenterOpen(false); setModelConfigOpen(true); }}>打开模型配置</button>
            </div>
          )}
          {settingsTab === "memory" && (
            <div className="settings-section">
              <h3>创作偏好</h3>
              <p className="settings-section-desc">账号内容方向的轻量画像，帮助模型理解你的内容风格与定位。</p>
              <button type="button" className="settings-section-action" onClick={() => { setSettingsCenterOpen(false); setAccountMemoryOpen(true); }}>编辑创作偏好</button>
            </div>
          )}
          {settingsTab === "profile" && (
            <div className="settings-section">
              <h3>创作者资料</h3>
              <p className="settings-section-desc">编辑昵称与头像，展示在你的工作台与项目中。</p>
              <button type="button" className="settings-section-action" onClick={() => { setSettingsCenterOpen(false); setCreatorProfileOpen(true); }}>编辑资料</button>
            </div>
          )}
          {settingsTab === "workspace" && (
            <div className="settings-section">
              <h3>工作区目录</h3>
              <p className="settings-section-desc">配置项目文档的本地输出目录。</p>
              <div className="settings-workspace-current">
                <label>当前输出目录</label>
                <div className="settings-workspace-path" title={workspace.outputDirAbsolute || workspace.outputDir}>
                  {workspace.outputDirAbsolute || workspace.outputDir}
                </div>
              </div>
              <div className="settings-section-row">
                <button type="button" className="settings-section-action" onClick={pickExternalDir} disabled={savingOutputDir}>
                  {savingOutputDir ? "更改中…" : "更改外部目录"}
                </button>
                {workspace.outputDirAbsolute && workspace.outputDirAbsolute !== workspace.outputDir && !workspace.outputDir.includes("项目内 output") && (
                  <button type="button" className="settings-section-action secondary" onClick={restoreDefaultOutputDir} disabled={savingOutputDir}>恢复项目内 output/</button>
                )}
              </div>
              {workspaceError && <p className="settings-section-error">{workspaceError}</p>}
            </div>
          )}
          {settingsTab === "appearance" && (
            <div className="settings-section">
              <h3>外观</h3>
              <p className="settings-section-desc">切换深浅色主题，适应不同环境下的创作节奏。</p>
              <button
                type="button"
                className="settings-section-action"
                onClick={() => {
                  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
                  const nextTheme = currentTheme === "dark" ? "light" : "dark";
                  document.documentElement.setAttribute("data-theme", nextTheme);
                  localStorage.setItem("preframe:theme", nextTheme);
                  window.dispatchEvent(new Event("preframe-theme-changed"));
                }}
              >
                切换深浅色主题
              </button>
            </div>
          )}
          {settingsTab === "maintenance" && <DataMaintenancePanel />}
        </div>
      </div>
    </Modal>
    <Modal
      open={workspaceSettingsOpen}
      title="工作区设置"
      description="配置项目文档的本地输出目录。"
      onClose={() => setWorkspaceSettingsOpen(false)}
      size="sm"
    >
      <div className="workspace-settings-content">
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>当前输出目录</label>
          <div style={{ padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 4, wordBreak: "break-all", fontSize: 13 }}>
            {workspace.outputDirAbsolute || workspace.outputDir}
          </div>
        </div>
        <div className="workspace-actions">
          <button className="workspace-change-button" type="button" onClick={pickExternalDir} disabled={savingOutputDir}>更改外部目录</button>
          {workspace.outputDirAbsolute && workspace.outputDirAbsolute !== workspace.outputDir && !workspace.outputDir.includes("项目内 output") && (
            <button className="workspace-change-button secondary" type="button" onClick={restoreDefaultOutputDir} disabled={savingOutputDir} style={{ marginTop: 8 }}>恢复项目内 output/</button>
          )}
        </div>
        {workspaceError && <p className="workspace-error" style={{ marginTop: 12 }}>{workspaceError}</p>}
      </div>
    </Modal>
    <ModelConfigModal open={modelConfigOpen} onClose={() => setModelConfigOpen(false)} onSaved={savedModelConfig} />
    <AccountMemoryModal open={accountMemoryOpen} onClose={() => setAccountMemoryOpen(false)} />
    <CreatorProfileModal open={creatorProfileOpen} onClose={() => setCreatorProfileOpen(false)} onSaved={() => window.dispatchEvent(new Event("piance-profile-updated"))} />
    </>
  );
}
