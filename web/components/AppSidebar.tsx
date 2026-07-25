"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Modal } from "./Modal";
import { ModelConfigModal } from "./ModelConfigModal";
import { AccountMemoryModal } from "./AccountMemoryModal";
import { CreatorProfileModal } from "./CreatorProfileModal";
import { readJsonResponse } from "../lib/readJsonResponse";

interface WorkspaceState {
  outputDir: string;
  outputDirAbsolute?: string;
  projectCount: number;
  totalSizeBytes: number;
  totalSizeLabel: string;
  currentProjectName: string;
}

const NAV_ITEMS = [
  { href: "/", label: "项目工作台", icon: "⌂", enabled: true },
  { href: "/projects", label: "历史项目", icon: "□", enabled: true },
] as const;

function defaultWorkspace(): WorkspaceState {
  return { outputDir: "output/", projectCount: 0, totalSizeBytes: 0, totalSizeLabel: "0 KB", currentProjectName: "未创建" };
}

export function AppSidebar() {
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<WorkspaceState>(defaultWorkspace);
  const [currentProjectName, setCurrentProjectName] = useState("未创建");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [savingOutputDir, setSavingOutputDir] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [settingsCenterOpen, setSettingsCenterOpen] = useState(false);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [accountMemoryOpen, setAccountMemoryOpen] = useState(false);
  const [creatorProfileOpen, setCreatorProfileOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("piance-workspace-expanded");
    if (saved !== null) {
      setWorkspaceExpanded(saved === "true");
    }
  }, []);

  const toggleWorkspace = () => {
    const next = !workspaceExpanded;
    setWorkspaceExpanded(next);
    localStorage.setItem("piance-workspace-expanded", String(next));
  };

  const loadWorkspace = useCallback(async (projectName = currentProjectName) => {
    const response = await fetch("/api/workspace");
    const data = await readJsonResponse<{ workspace: WorkspaceState; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "本地工作区读取失败。");
    const next = data.workspace as WorkspaceState;
    setWorkspace({ ...next, currentProjectName: projectName });
  }, [currentProjectName]);

  useEffect(() => {
    loadWorkspace().catch((error) => setWorkspaceError(error instanceof Error ? error.message : "本地工作区读取失败。"));
  }, [loadWorkspace]);

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

  const activePath = useMemo(() => pathname === "/projects" || pathname.startsWith("/projects/") ? "/projects" : "/", [pathname]);

  function createProject() {
    setMobileOpen(false);
    if (pathname === "/") {
      window.dispatchEvent(new Event("piance-open-new-task"));
      return;
    }
    window.location.href = "/";
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
        <div><strong>片策</strong><small>短视频前期策划工作台</small></div>
      </div>

      <button className="sidebar-create-button" type="button" onClick={createProject}><span>＋</span>创建内容项目</button>

      <nav className="app-nav" aria-label="片策导航">
        {NAV_ITEMS.map((item) => (
          <Link className={activePath === item.href ? "active" : ""} href={item.href} onClick={() => setMobileOpen(false)} key={item.label}><span>{item.icon}</span>{item.label}</Link>
        ))}
        <button type="button" className={settingsCenterOpen || modelConfigOpen || accountMemoryOpen ? "active" : ""} title="设置中心" onClick={() => { setMobileOpen(false); setSettingsCenterOpen(true); }}><span>⚙</span>设置中心</button>
      </nav>

      <section className="workspace-card sidebar-workspace-collapsible">
        <button type="button" className="workspace-card-toggle" onClick={toggleWorkspace}>
          <h2>本地工作区</h2>
          <span>{workspace.projectCount} 个项目</span>
        </button>
        {workspaceExpanded && (
          <div className="workspace-card-content">
            <dl>
              <div><dt>当前项目</dt><dd title={currentProjectName}>{currentProjectName}</dd></div>
              <div><dt>占用空间</dt><dd>{workspace.totalSizeLabel}</dd></div>
              <div>
                <dt>输出目录</dt>
                <dd title={workspace.outputDirAbsolute || workspace.outputDir}>
                  {workspace.outputDirAbsolute && !workspace.outputDir.includes("项目内 output")
                    ? workspace.outputDirAbsolute.split(/[/\\]/).pop() || workspace.outputDirAbsolute
                    : "项目内 output/"}
                </dd>
              </div>
            </dl>
          </div>
        )}
        {workspaceError && <p className="workspace-error">{workspaceError}</p>}
      </section>
    </aside>
    <Modal
      open={settingsCenterOpen}
      title="设置中心"
      description="全局配置中心"
      onClose={() => setSettingsCenterOpen(false)}
      size="sm"
    >
      <div className="settings-center-actions">
        <button type="button" onClick={() => { setSettingsCenterOpen(false); setModelConfigOpen(true); }}>
          <strong>模型配置</strong>
          <span>生成模型与连接参数</span>
        </button>
        <button type="button" onClick={() => { setSettingsCenterOpen(false); setAccountMemoryOpen(true); }}>
          <strong>账号记忆</strong>
          <span>创作者账号画像</span>
        </button>
        <button type="button" onClick={() => { setSettingsCenterOpen(false); setCreatorProfileOpen(true); }}>
          <strong>创作者资料</strong>
          <span>编辑昵称与头像</span>
        </button>
        <button type="button" onClick={() => { setSettingsCenterOpen(false); setWorkspaceSettingsOpen(true); }}>
          <strong>工作区目录</strong>
          <span>输出与存储位置</span>
        </button>
        <button type="button" onClick={() => { 
          setSettingsCenterOpen(false); 
          const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
          const nextTheme = currentTheme === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", nextTheme);
          localStorage.setItem("preframe:theme", nextTheme);
          window.dispatchEvent(new Event("preframe-theme-changed"));
        }}>
          <strong>外观设置</strong>
          <span>切换深浅色主题</span>
        </button>
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
          <div style={{ padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, wordBreak: "break-all", fontSize: 13 }}>
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
