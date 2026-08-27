"use client";

import {
  ArrowClockwise,
  CaretDown,
  Copy,
  DownloadSimple,
  DotsThree,
  WarningCircle,
  Package,
} from "@phosphor-icons/react";
import type { ResultFile } from "./ResultTabs";
import { MarkdownPreview } from "./MarkdownPreview";

interface DocumentWorkspaceProps {
  file?: ResultFile;
  selectedFileName?: string;
  failureReasons?: string[];
  error: string;
  notice: string;
  onDownload: () => void;
  onCopy: () => void;
  onDownloadAll: () => void;
  canRegenerate?: boolean;
  regenerating?: boolean;
  onRegenerate?: () => void;
  onRetrySelected?: () => void;
}

export function DocumentWorkspace({
  file,
  selectedFileName,
  failureReasons = [],
  error,
  notice,
  onDownload,
  onCopy,
  onDownloadAll,
  canRegenerate = false,
  regenerating = false,
  onRegenerate,
  onRetrySelected,
}: DocumentWorkspaceProps) {
  const failedSelection = !file && Boolean(selectedFileName && failureReasons.length);
  const dependencyFailure = failureReasons.some((reason) => reason.includes("依赖文档"));
  return (
    <section className="document-workspace">
      <header className="document-commandbar">
        {failedSelection && <span className="document-failure-status"><WarningCircle size={14} weight="fill" />生成失败</span>}
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
      {notice && <div className="product-alert alert-success"><span>✓</span><div><strong>操作已完成</strong><p>{notice}</p></div></div>}
      {file?.validationErrors && file.validationErrors.length > 0 && (
        <div className="product-alert alert-warning" role="alert">
          <span>!</span>
          <div><strong>当前文档未通过校验</strong><p>{file.validationErrors.join("；")}</p></div>
        </div>
      )}
      <div className="canvas-stage">
        {file ? (
          <div className="markdown-canvas"><MarkdownPreview content={file.content} /></div>
        ) : failedSelection ? (
          <section className="document-failure-view" aria-labelledby="document-failure-title">
            <span className="document-failure-icon"><WarningCircle size={24} weight="fill" /></span>
            <p className="document-failure-kicker">该文档尚未生成</p>
            <h3 id="document-failure-title">{selectedFileName}</h3>
            <div className="document-failure-reason">
              <strong>失败原因</strong>
              {failureReasons.map((reason) => <p key={reason}>{reason}</p>)}
            </div>
            <p className="document-failure-guidance">{dependencyFailure ? "重试时会先修复缺失的依赖文档，再继续生成当前文档。" : "重试只处理当前失败项，已生成的文档不会被覆盖。"}</p>
            <button className="primary-button document-retry-button" type="button" disabled={regenerating} onClick={onRetrySelected}>
              <ArrowClockwise size={17} weight="bold" />{regenerating ? "正在重新生成" : dependencyFailure ? "修复依赖并重新生成" : "重新生成当前文档"}
            </button>
          </section>
        ) : (
          <div className="empty-card">项目中没有 Markdown 文件。</div>
        )}
      </div>
      <footer className="document-statusbar">{failedSelection ? "尚未生成" : "已保存"}</footer>
    </section>
  );
}
