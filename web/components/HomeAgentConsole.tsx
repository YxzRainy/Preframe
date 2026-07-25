"use client";

import Link from "next/link";
import { useState } from "react";
import { ModelStatusBadge } from "./ModelStatusBadge";

interface HomeAgentConsoleProps {
  projectSlug: string;
  projectName: string;
  loading: boolean;
  model: string;
  fileCount: number;
  generationStage: string;
  projectStatus?: "complete" | "partial" | "failed";
}

const TOTAL_DOCUMENTS = 10;

export function HomeAgentConsole({ projectSlug, projectName, loading, model, fileCount, generationStage, projectStatus = "complete" }: HomeAgentConsoleProps) {
  const [open, setOpen] = useState(false);
  const projectUrl = `/projects/${encodeURIComponent(projectSlug)}`;
  const openModelConfig = () => window.dispatchEvent(new Event("piance-open-model-config"));

  return (
    <>
      {/* 始终可见的右侧工具栏 */}
      <aside className={`agent-toolbar ${open ? "drawer-open" : ""}`}>
        <button type="button" className="toolbar-btn" onClick={() => setOpen(true)} title="修改文档">
          <span className="toolbar-icon">✎</span>
        </button>
        <button type="button" className="toolbar-btn" onClick={() => setOpen(true)} title="重新生成">
          <span className="toolbar-icon">↻</span>
          {loading && <span className="toolbar-dot" aria-hidden="true" />}
        </button>
        <button type="button" className="toolbar-btn" onClick={() => setOpen(true)} title="素材扫描">
          <span className="toolbar-icon">◎</span>
        </button>
        <button type="button" className="toolbar-btn" onClick={() => setOpen(true)} title="导出">
          <span className="toolbar-icon">⎘</span>
        </button>
        
        <div className="toolbar-spacer" />
        
        <button type="button" className="toolbar-btn" onClick={openModelConfig} title="模型配置">
          <span className="toolbar-icon">⚙</span>
        </button>
      </aside>

      {/* 展开后的抽屉 */}
      {open && (
        <>
          <div className="agent-drawer-backdrop" onClick={() => setOpen(false)} />
          <aside className="agent-drawer">
            <div className="agent-drawer-header">
              <div>
                <strong>Agent 控制台</strong>
                <ModelStatusBadge />
              </div>
              <button type="button" className="agent-drawer-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>

            <div className="agent-drawer-body">
              {/* 模型状态 */}
              <button type="button" className="agent-drawer-model" onClick={openModelConfig}>
                <small>当前模型</small>
                <strong>{model}</strong>
              </button>

              {/* 当前任务 */}
              <div className="agent-drawer-section">
                <span className="agent-drawer-label">当前任务</span>
                {loading ? (
                  <div className="agent-drawer-task running">{generationStage}<b><i /><i /><i /></b></div>
                ) : projectSlug ? (
                  <div className={`agent-drawer-task ${projectStatus === "complete" ? "done" : "partial"}`}>
                    {projectStatus === "complete" ? `${fileCount}/${TOTAL_DOCUMENTS} 已完成` : `${fileCount}/${TOTAL_DOCUMENTS} 可用`}
                  </div>
                ) : (
                  <div className="agent-drawer-task idle">等待创建项目</div>
                )}
              </div>

              {/* 快捷操作 */}
              <div className="agent-drawer-section">
                <span className="agent-drawer-label">操作</span>
                <div className="agent-drawer-actions">
                  {projectSlug && (
                    <Link className="agent-drawer-action" href={projectUrl}>打开项目页</Link>
                  )}
                  <button type="button" className="agent-drawer-action" onClick={() => { setOpen(false); window.dispatchEvent(new Event("piance-open-new-task")); }}>
                    {projectSlug ? "重新生成" : "创建项目"}
                  </button>
                  <button type="button" className="agent-drawer-action" onClick={openModelConfig}>模型配置</button>
                  {projectName && <div className="agent-drawer-project-name">{projectName}</div>}
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
