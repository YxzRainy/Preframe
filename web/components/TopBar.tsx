"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { List, MagnifyingGlass, MoonStars, Sun } from "@phosphor-icons/react";
import { StatusBadge } from "./StatusBadge";
import { Modal } from "./Modal";
import { ModelStatusBadge } from "./ModelStatusBadge";
import { isPrimaryProjectDocument, PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";
import { readJsonResponse } from "../lib/readJsonResponse";

export interface CreatorProfile {
  name: string;
  avatarUrl: string;
}

interface CurrentProjectState {
  title: string;
  status: string;
  tone: "ready" | "working" | "muted" | "warning";
}

interface ProjectDetailResponse {
  success: boolean;
  project?: {
    slug: string;
    name: string;
    metadata?: Record<string, unknown>;
    files?: { name: string }[];
  };
  error?: string;
}

function fallbackProjectName(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug || "项目工作区";
  }
}

function routeState(pathname: string): CurrentProjectState {
  if (pathname === "/") return { title: "", status: "工作台", tone: "muted" };
  if (pathname === "/projects") return { title: "", status: "项目库", tone: "muted" };
  if (pathname.startsWith("/projects/")) {
    const slug = pathname.split("/").filter(Boolean).at(-1) || "";
    return { title: fallbackProjectName(slug), status: "正在打开项目", tone: "working" };
  }
  return { title: "", status: "本地运行", tone: "muted" };
}

function completedStatus(fileCount: number, total: number = PROJECT_DOCUMENT_DEFINITIONS.length): string {
  if (fileCount === total) return `已打开项目 · ${total}/${total} 已完成`;
  return `已打开项目 · ${fileCount}/${total} 可用`;
}

function generatedStatus(fileCount?: number, total: number = PROJECT_DOCUMENT_DEFINITIONS.length): string {
  if (!fileCount) return "尚无可用文档";
  if (fileCount === total) return `核心工作稿已完成 · ${total}/${total}`;
  return `${fileCount}/${total} 可用，部分文档生成失败`;
}

interface TopBarProps {
  initialProfile: CreatorProfile;
}

export function TopBar({ initialProfile }: TopBarProps) {
  const pathname = usePathname();
  const [currentProject, setCurrentProject] = useState<CurrentProjectState>(() => routeState(pathname));
  const [profile, setProfile] = useState<CreatorProfile>(() => initialProfile);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    // 首次挂载获取当前主题
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(currentTheme);

    const onThemeChanged = () => {
      setTheme(document.documentElement.getAttribute("data-theme") || "dark");
    };
    window.addEventListener("preframe-theme-changed", onThemeChanged);
    return () => window.removeEventListener("preframe-theme-changed", onThemeChanged);
  }, []);

  async function loadProfile() {
    const response = await fetch("/api/profile");
    const data = await readJsonResponse<{ profile: CreatorProfile; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "创作者资料读取失败。");
    const next = data.profile as CreatorProfile;
    setProfile(next);
    setAvatarFailed(false);
    setAvatarVersion(Date.now());
  }

  useEffect(() => {
    const handleProfileUpdated = () => {
      loadProfile().catch(() => undefined);
    };
    window.addEventListener("piance-profile-updated", handleProfileUpdated);
    return () => window.removeEventListener("piance-profile-updated", handleProfileUpdated);
  }, []);

  useEffect(() => {
    setCurrentProject(routeState(pathname));
    if (!pathname.startsWith("/projects/")) return;
    const slug = pathname.split("/").filter(Boolean).at(-1) || "";
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(fallbackProjectName(slug))}`)
      .then(async (response) => {
        const data = await readJsonResponse<ProjectDetailResponse>(response);
        if (!response.ok || !data.success || !data.project) throw new Error(data.error || "项目读取失败。");
        return data.project;
      })
      .then((project) => {
        if (!active) return;
        const statuses = project.metadata?.documentsStatus && typeof project.metadata.documentsStatus === "object" ? project.metadata.documentsStatus as Record<string, { status?: string }> : {};
        const total = project.metadata?.workflowVersion === 2 ? PROJECT_DOCUMENT_DEFINITIONS.length : Math.max(Object.keys(statuses).length, project.files?.filter((file) => isPrimaryProjectDocument(file.name)).length || 1);
        const fileCount = Object.values(statuses).filter((item) => item.status === "completed").length || project.files?.filter((file) => isPrimaryProjectDocument(file.name)).length || 0;
        setCurrentProject({ title: project.name || project.slug, status: completedStatus(fileCount, total), tone: fileCount === total ? "ready" : "warning" });
      })
      .catch(() => {
        if (active) setCurrentProject({ title: fallbackProjectName(slug), status: "项目读取失败", tone: "warning" });
      });
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    const onProjectChange = (event: Event) => {
      const detail = (event as CustomEvent<Partial<CurrentProjectState> & { projectName?: string; fileCount?: number }>).detail;
      const title = detail.title || detail.projectName;
      if (!title) return;
      setCurrentProject({
        title,
        status: detail.status || generatedStatus(detail.fileCount),
        tone: detail.tone || "ready",
      });
    };
    window.addEventListener("piance-current-project", onProjectChange);
    return () => window.removeEventListener("piance-current-project", onProjectChange);
  }, []);

  const avatarSrc = avatarVersion ? `${profile.avatarUrl}?v=${avatarVersion}` : profile.avatarUrl;
  const showAvatarImage = !avatarFailed;

  return (
    <header className="control-bar">
      <div className="mobile-top-brand">
        <span><img src="/brand-icon.png" alt="片策" /></span>
        <strong>片策</strong>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="theme-toggle"
          aria-label="切换浅色/深色主题"
          aria-pressed={theme === "light"}
          title="切换浅色/深色"
          onClick={() => {
            const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
            const nextTheme = currentTheme === "dark" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", nextTheme);
            localStorage.setItem("preframe:theme", nextTheme);
            setTheme(nextTheme);
            window.dispatchEvent(new Event("preframe-theme-changed"));
          }}
        >
          {theme === "dark" ? <Sun size={17} weight="duotone" /> : <MoonStars size={17} weight="duotone" />}
        </button>
        <button type="button" className="topbar-search-trigger" aria-label="搜索项目与文档" onClick={() => window.dispatchEvent(new Event("preframe-open-command-palette"))}>
          <MagnifyingGlass size={16} weight="bold" /><span>搜索</span><kbd>⌘K</kbd>
        </button>
      </div>
      <div className="topbar-page-title">
        {currentProject.title && <h2>{currentProject.title}</h2>}
      </div>
      <div className="topbar-account">
        <span className="topbar-model-status"><ModelStatusBadge compact /></span>
        <div className="creator-entry" aria-label="创作者资料" onClick={() => window.dispatchEvent(new Event("piance-open-sidebar"))}>
          <span className="creator-avatar">{showAvatarImage ? <img src={avatarSrc} alt={`${profile.name}的头像`} onError={() => setAvatarFailed(true)} /> : <i />}</span>
          <div><strong>{profile.name}</strong></div>
        </div>
      </div>
      <button className="mobile-menu-button" type="button" aria-label="打开菜单" onClick={() => window.dispatchEvent(new Event("piance-open-sidebar"))}>
        <List size={21} weight="bold" />
      </button>
    </header>
  );
}
