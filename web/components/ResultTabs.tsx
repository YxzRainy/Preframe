"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarkdownPreview } from "./MarkdownPreview";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";

export interface ResultFile {
  name: string;
  content: string;
  status?: "completed" | "failed";
  validationErrors?: string[];
}

interface ResultTabsProps {
  files: ResultFile[];
  activeName?: string;
  onActiveChange?: (name: string) => void;
  loading?: boolean;
  onCreateProject?: () => void;
  modelConfigured?: boolean;
}

const TOTAL_DOCUMENTS = PROJECT_DOCUMENT_DEFINITIONS.length;

function docNumber(name: string): string {
  return name.replace(/^(\d+)_.*$/, "$1");
}

function docTitle(name: string): string {
  return name.replace(/^\d+_/, "").replace(/\.md$/i, "");
}

type DocItemStatus = "ready" | "generating" | "waiting" | "failed";

function docItemStatus(file: ResultFile | undefined, loading: boolean, hasAnyFile: boolean): DocItemStatus {
  if (file?.status === "failed" || file?.validationErrors?.length) return "failed";
  if (file) return "ready";
  if (loading) return "generating";
  if (hasAnyFile) return "failed";
  return "waiting";
}

export function ResultTabs({
  files,
  activeName,
  onActiveChange,
  loading = false,
  onCreateProject,
}: ResultTabsProps) {
  const [internalActive, setInternalActive] = useState(files[0]?.name ?? "");
  const active = activeName ?? internalActive;
  const hasAnyFile = files.length > 0;

  useEffect(() => {
    if (files.length && !files.some((f) => f.name === active)) {
      setInternalActive(files[0].name);
      onActiveChange?.(files[0].name);
    }
  }, [files, active, onActiveChange]);

  const current = files.find((f) => f.name === active) ?? files[0];

  const select = (name: string) => {
    setInternalActive(name);
    onActiveChange?.(name);
  };

  // 未生成状态
  if (!hasAnyFile && !loading) {
    const onboardingDescriptions = [
      "明确目标与内容方向", "拆出核心观点与结构", "生成可直接拍摄的表达", "安排镜头与剪辑节奏", "整理场景、道具和设备",
      "优化搜索与点击率", "指导 AI 绘制封面素材", "规避平台敏感词风险", "打印或在手机端对照拍摄", "评论区与粉丝互动策略"
    ];
    return (
      <div className="onboarding-panel">
        <header className="onboarding-hero">
          <div className="hero-content">
            <span className="hero-badge">短视频前期策划工作台</span>
            <h1>从一个选题，到一套可以直接执行的内容方案</h1>
            <p>生成脚本、分镜、拍摄清单、内容质检和发布承接</p>
            <div className="hero-actions">
              {onCreateProject && (
                <button className="primary-button hero-btn" type="button" onClick={onCreateProject}>创建内容项目</button>
              )}
              <Link href="/projects" className="secondary-button hero-btn">查看历史项目</Link>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual-card card-1" />
            <div className="hero-visual-card card-2" />
            <div className="hero-visual-card card-3" />
          </div>
        </header>

        <section className="onboarding-modules">
          <h3>完整前期策划包</h3>
          <div className="onboarding-grid">
            {PROJECT_DOCUMENT_DEFINITIONS.map((def, i) => (
              <div className="onboarding-card" key={def.key}>
                <div className="onboarding-card-head">
                  <span className="onboarding-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="onboarding-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                  </span>
                </div>
                <strong>{def.title}</strong>
                <small>{onboardingDescriptions[i] || "自动生成对应内容"}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="doc-main-layout">
      {/* 左侧紧凑文档索引 */}
      <nav className="doc-index" aria-label="文档索引">
        {PROJECT_DOCUMENT_DEFINITIONS.map((def, i) => {
          const file = files.find((f) => f.name === def.filename);
          const status = docItemStatus(file, loading, hasAnyFile);
          const isActive = Boolean(file && file.name === active);
          return (
            <button
              key={def.key}
              type="button"
              className={`doc-index-item status-${status}${isActive ? " active" : ""}`}
              onClick={() => file && select(file.name)}
              disabled={!file}
              title={def.title}
            >
              <span className="doc-index-num">{String(i + 1).padStart(2, "0")}</span>
              <span className="doc-index-title">{def.title}</span>
              <span className="doc-index-dot" aria-hidden="true" />
            </button>
          );
        })}
        {hasAnyFile && (
          <div className="doc-index-footer">
            {files.length}/{TOTAL_DOCUMENTS} 可用
          </div>
        )}
      </nav>

      {/* 右侧文档正文 */}
      <article className="doc-reader">
        {current ? (
          <>
            <div className="doc-reader-title">
              <span className="doc-reader-num">{docNumber(current.name)}</span>
              <h2>{docTitle(current.name)}</h2>
              {current.status === "failed" && (
                <span className="doc-reader-badge failed">校验失败</span>
              )}
            </div>
            <div className="doc-reader-body">
              <MarkdownPreview content={current.content} />
            </div>
          </>
        ) : loading ? (
          <div className="doc-reader-loading">
            <span className="doc-spinner" />
            <p>正在生成文档…</p>
          </div>
        ) : null}
      </article>
    </div>
  );
}
