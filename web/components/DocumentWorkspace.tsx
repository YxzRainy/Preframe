"use client";

import {
  ArrowClockwise,
  CaretDown,
  CheckCircle,
  Copy,
  DownloadSimple,
  DotsThree,
  FileText,
  Package,
} from "@phosphor-icons/react";
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
          <div className="document-name-row"><span className="file-format-badge"><FileText size={15} weight="fill" /></span><h2>{file?.name || "未选择文档"}</h2></div>
          <div className="document-context-line">
            <StatusBadge tone="ready">可修改</StatusBadge>
            <span className="save-state"><CheckCircle size={13} weight="fill" />已保存到本地</span>
          </div>
        </div>
        <div className="document-actions">
          <button className="secondary-button" type="button" disabled={!file} onClick={onCopy}><Copy size={15} weight="bold" />复制正文</button>
          <details className="document-more-menu">
            <summary><DotsThree size={19} weight="bold" /><span>更多</span><CaretDown size={12} weight="bold" /></summary>
            <div className="document-more-popover">
              <button className="export-control" data-export-current type="button" disabled={!file} onClick={onDownload}><DownloadSimple size={16} />导出当前文档</button>
              <button className="export-bundle-control" type="button" onClick={onDownloadAll}><Package size={16} />导出完整内容包</button>
              {canRegenerate && <button type="button" disabled={regenerating} onClick={onRegenerate}><ArrowClockwise size={16} />{regenerating ? "正在重新生成" : "重新生成异常文档"}</button>}
            </div>
          </details>
        </div>
      </header>
      {error && <div className="product-alert alert-warning" role="alert"><span>!</span><div><strong>执行提示</strong><p>{error}</p></div></div>}
      {notice && <div className="product-alert alert-success"><span>✓</span><div><strong>任务已完成</strong><p>{notice}</p></div></div>}
      {file?.validationErrors && file.validationErrors.length > 0 && (
        <div className="product-alert alert-warning" role="alert">
          <span>!</span>
          <div><strong>当前文档未通过校验</strong><p>{file.validationErrors.join("；")}</p></div>
        </div>
      )}
      <div className="canvas-stage">
        {file ? <div className="markdown-canvas"><MarkdownPreview content={file.content} /></div> : <div className="empty-card">项目中没有 Markdown 文件。</div>}
      </div>
      <footer className="document-statusbar"><span>UTF-8</span><span>Markdown</span><span>本地文件</span><span className="statusbar-spacer" /><span className="pulse-dot" /> 已保存</footer>
    </section>
  );
}
