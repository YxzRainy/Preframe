"use client";

import type { ResultFile } from "./ResultTabs";
import { MarkdownPreview } from "./MarkdownPreview";
import { StatusBadge } from "./StatusBadge";

interface DocumentWorkspaceProps {
  file?: ResultFile;
  error: string;
  notice: string;
  onDownload: () => void;
  onCopy: () => void;
  onDownloadAll: () => void;
  canRegenerate?: boolean;
  regenerating?: boolean;
  onRegenerate?: () => void;
}

export function DocumentWorkspace({ file, error, notice, onDownload, onCopy, onDownloadAll, canRegenerate = false, regenerating = false, onRegenerate }: DocumentWorkspaceProps) {
  return (
    <section className="document-workspace">
      <header className="document-commandbar">
        <div className="document-title-group">
          <div className="document-path"><span>项目文档</span><i>/</i><span>Markdown</span></div>
          <div className="document-name-row"><span className="file-format-badge">MD</span><h2>{file?.name || "未选择文档"}</h2><StatusBadge tone="ready">可修改当前文档</StatusBadge></div>
        </div>
        <div className="document-actions">
          {canRegenerate && <button className="secondary-button" type="button" disabled={regenerating} onClick={onRegenerate}>{regenerating ? "正在重新生成" : "重新生成异常文档"}</button>}
          <span className="save-state">● 已保存到本地</span>
          <button className="secondary-button" type="button" disabled={!file} onClick={onCopy}><span>⧉</span> 复制正文</button>
          <button className="secondary-button export-control" data-export-current type="button" disabled={!file} onClick={onDownload}><span>↓</span> 导出 Markdown</button>
          <button className="secondary-button export-bundle-control" type="button" onClick={onDownloadAll}><span>⇩</span> 导出内容包</button>
        </div>
      </header>
      {error && <div className="product-alert alert-warning" role="alert"><span>!</span><div><strong>执行提示</strong><p>{error}</p></div></div>}
      {notice && <div className="product-alert alert-success"><span>✓</span><div><strong>任务已完成</strong><p>{notice}</p></div></div>}
      <div className="canvas-stage">
        {file ? <div className="markdown-canvas"><MarkdownPreview content={file.content} /></div> : <div className="empty-card">项目中没有 Markdown 文件。</div>}
      </div>
      <footer className="document-statusbar"><span>UTF-8</span><span>Markdown</span><span>本地文件</span><span className="statusbar-spacer" /><span className="pulse-dot" /> 已保存</footer>
    </section>
  );
}
