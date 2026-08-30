"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CaretRight, CheckCircle, CloudArrowDown, FolderOpen, GearSix, HardDrives, House, Lightbulb, Plus, WarningCircle, X } from "@phosphor-icons/react";
import { readJsonResponse } from "../lib/readJsonResponse";
import { clearLegacyBrowserApiKey } from "../lib/modelConfigClient";

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
  { href: "/ideas", label: "灵感", icon: <Lightbulb size={19} weight="duotone" /> },
  { href: "/settings", label: "设置", icon: <GearSix size={19} weight="duotone" /> },
];

interface AppSidebarProps {
  initialWorkspace: WorkspaceState;
}

interface PublicModelConfig {
  configured: boolean;
}

type ModelStatus = "checking" | "ready" | "attention";

export function AppSidebar({ initialWorkspace }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => initialWorkspace);
  const [currentProjectName, setCurrentProjectName] = useState(() => initialWorkspace.currentProjectName || "未创建");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("checking");
  const [lastBackupAt, setLastBackupAt] = useState("");

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
    const openSettings = (tab: "model" | "memory") => {
      setMobileOpen(false);
      router.push(`/settings?tab=${tab}`);
    };
    const openModelConfig = () => openSettings("model");
    const openAccountMemory = () => openSettings("memory");
    window.addEventListener("piance-open-model-config", openModelConfig);
    window.addEventListener("piance-open-account-memory", openAccountMemory);
    return () => {
      window.removeEventListener("piance-open-model-config", openModelConfig);
      window.removeEventListener("piance-open-account-memory", openAccountMemory);
    };
  }, [router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileOpen(false); setStatusOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => { clearLegacyBrowserApiKey(); }, []);

  const loadSystemStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/model-config", { cache: "no-store" });
      const data = await readJsonResponse<{ config?: PublicModelConfig }>(response);
      setModelStatus(response.ok && Boolean(data.config?.configured) ? "ready" : "attention");
    } catch {
      setModelStatus("attention");
    }
  }, []);

  useEffect(() => {
    try { setLastBackupAt(window.localStorage.getItem("piance:last-config-backup-at") || ""); } catch { /* local storage unavailable */ }
    void loadSystemStatus();
    window.addEventListener("piance-model-config-updated", loadSystemStatus);
    return () => window.removeEventListener("piance-model-config-updated", loadSystemStatus);
  }, [loadSystemStatus]);

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
      loadWorkspace(name).catch((error) => setWorkspaceError(error instanceof Error ? error.message : "本地工作区读取失败。"));
    };
    window.addEventListener("piance-current-project", handler);
    return () => window.removeEventListener("piance-current-project", handler);
  }, [loadWorkspace]);

  const activePath = useMemo(() => {
    if (pathname === "/") return "/";
    if (pathname === "/ideas" || pathname.startsWith("/ideas/")) return "/ideas";
    if (pathname === "/projects" || pathname.startsWith("/projects/")) return "/projects";
    if (pathname === "/settings" || pathname.startsWith("/settings/")) return "/settings";
    return "/";
  }, [pathname]);

  function createProject() {
    setMobileOpen(false);
    window.dispatchEvent(new Event("piance-open-new-task"));
  }

  function openSettings(tab: "model" | "workspace" | "maintenance") {
    setStatusOpen(false);
    setMobileOpen(false);
    router.push(`/settings?tab=${tab}`);
  }

  function downloadBackup() {
    const anchor = document.createElement("a");
    anchor.href = "/api/maintenance/backup";
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const timestamp = new Date().toISOString();
    try { window.localStorage.setItem("piance:last-config-backup-at", timestamp); } catch { /* backup remains available without local timestamp */ }
    setLastBackupAt(timestamp);
  }

  function formatBackupLabel(value: string) {
    if (!value) return "可随时导出";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "可随时导出";
    return `上次导出 ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date)}`;
  }

  const modelReady = modelStatus === "ready";
  const backupLabel = formatBackupLabel(lastBackupAt);

  return (
    <>
      <button className={`mobile-sidebar-backdrop ${mobileOpen ? "open" : ""}`} type="button" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} />
      <aside className={`app-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="app-sidebar-brand">
          <span className="app-sidebar-logo" role="img" aria-label="片策">
            <img className="app-sidebar-logo-dark" src="/brand-icon.png" alt="" />
            <img className="app-sidebar-logo-light" src="/brand-icon-light.png" alt="" />
          </span>
          <div><strong>片策</strong></div>
        </div>

        <button className="sidebar-create-button create-project-entry" type="button" onClick={createProject}><Plus size={18} weight="bold" />新建项目</button>

        <nav className="app-nav" aria-label="片策导航">
          {NAV_ITEMS.map((item) => (
            <Link className={activePath === item.href ? "active" : ""} href={item.href} onClick={() => setMobileOpen(false)} key={item.label}><span>{item.icon}</span>{item.label}<i /></Link>
          ))}
        </nav>

        <section className={`workspace-card global-health-card ${statusOpen ? "is-open" : ""} ${modelStatus === "attention" ? "needs-attention" : ""}`}>
          <button className="workspace-status-trigger" type="button" aria-expanded={statusOpen} aria-controls="global-system-status" onClick={() => setStatusOpen((open) => !open)}>
            <span className={`workspace-status-dot ${modelStatus}`} aria-hidden="true" />
            <span className="workspace-status-copy"><strong>{modelStatus === "attention" ? "需要配置模型" : modelStatus === "checking" ? "正在检查状态" : "系统运行正常"}</strong><small>本地工作区 · {workspace.projectCount} 个项目</small></span>
            <CaretRight className="workspace-status-caret" size={15} aria-hidden="true" />
          </button>
          {statusOpen && <div id="global-system-status" className="workspace-status-popover" role="dialog" aria-label="系统状态">
            <div className="workspace-status-popover-head"><span>系统状态</span><button type="button" aria-label="关闭系统状态" onClick={() => setStatusOpen(false)}><X size={15} /></button></div>
            <div className="workspace-status-rows">
              <button type="button" onClick={() => openSettings("model")}><span className={modelReady ? "is-ready" : "is-warning"}>{modelReady ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} weight="fill" />}</span><div><strong>{modelReady ? "模型已连接" : "模型尚未配置"}</strong><small>{modelReady ? "生成时会自动使用当前模型" : "配置 API Key 后即可开始生成"}</small></div><CaretRight size={14} /></button>
              <button type="button" onClick={() => openSettings("workspace")}><span><HardDrives size={15} /></span><div><strong>本地工作区</strong><small>{workspace.projectCount} 个项目 · {workspace.totalSizeLabel}</small></div><CaretRight size={14} /></button>
              <div className="workspace-backup-row"><span><CloudArrowDown size={15} /></span><div><strong>本地配置备份</strong><small>{backupLabel} · 密钥不会包含在备份中</small></div><button type="button" onClick={downloadBackup}>立即备份</button></div>
            </div>
            {workspaceError && <p className="workspace-error">{workspaceError}</p>}
            <button className="workspace-status-settings" type="button" onClick={() => openSettings("maintenance")}>打开数据维护 <CaretRight size={14} /></button>
          </div>}
        </section>
      </aside>
    </>
  );
}
