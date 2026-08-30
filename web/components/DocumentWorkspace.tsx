"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ArrowClockwise,
  Check,
  CheckCircle,
  Copy,
  DownloadSimple,
  DotsThree,
  WarningCircle,
  Package,
  MagicWand,
  Eye,
  PencilSimple,
  FloppyDisk,
  X,
} from "@phosphor-icons/react";
import type { ResultFile } from "./ResultTabs";
import { MarkdownPreview } from "./MarkdownPreview";
import { RichMarkdownEditor } from "./RichMarkdownEditor";

interface DocumentWorkspaceProps {
  file?: ResultFile;
  /** Changes whenever a new project document is selected, replaying its enter motion. */
  transitionKey?: string;
  selectedFileName?: string;
  failureReasons?: string[];
  error: string;
  notice: string;
  noticeDetails?: string[];
  onDownload: () => void;
  onCopy: () => void;
  onDownloadAll: () => void;
  canRegenerate?: boolean;
  regenerating?: boolean;
  onRegenerate?: () => void;
  onRetrySelected?: () => void;
  refineFeedback?: string;
  refining?: boolean;
  repairing?: boolean;
  onRepair?: () => void;
  onRefineFeedbackChange?: (value: string) => void;
  onRefine?: (event: FormEvent<HTMLFormElement>) => void;
  onSave?: (content: string) => Promise<string | void>;
  onDocumentSaved?: () => void;
  onNoticeConfirm?: () => void;
}

export function DocumentWorkspace({
  file,
  transitionKey,
  selectedFileName,
  failureReasons = [],
  error,
  notice,
  noticeDetails = [],
  onDownload,
  onCopy,
  onDownloadAll,
  canRegenerate = false,
  regenerating = false,
  onRegenerate,
  onRetrySelected,
  refineFeedback = "",
  refining = false,
  repairing = false,
  onRepair,
  onRefineFeedbackChange,
  onRefine,
  onSave,
  onDocumentSaved,
  onNoticeConfirm,
}: DocumentWorkspaceProps) {
  const failedSelection = !file && Boolean(selectedFileName && failureReasons.length);
  const blockedSelection = failedSelection && failureReasons.some((reason) => /本次未生成/u.test(reason));
  const dependencyFailure = failureReasons.some((reason) => /依赖文档|本次未生成/u.test(reason));
  const [refineOpen, setRefineOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [draft, setDraft] = useState("");
  const [editorDocument, setEditorDocument] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const draftRef = useRef("");
  const savedRef = useRef("");

  useEffect(() => {
    const content = file?.content || "";
    draftRef.current = content;
    savedRef.current = content;
    setDraft(content);
    setEditorDocument(content);
    setSaveState("saved");
    setSaveError("");
  }, [file?.name, file?.content]);

  const saveDraft = useCallback(async () => {
    if (!file || !onSave || draftRef.current === savedRef.current) return;
    setSaveState("saving");
    setSaveError("");
    try {
      const content = await onSave(draftRef.current);
      const persisted = typeof content === "string" ? content : draftRef.current;
      savedRef.current = persisted;
      if (draftRef.current === persisted || draftRef.current === content) setSaveState("saved");
      else setSaveState("dirty");
      onDocumentSaved?.();
    } catch (caught) {
      setSaveState("error");
      setSaveError(caught instanceof Error ? caught.message : "自动保存失败，请重试。");
    }
  }, [file, onDocumentSaved, onSave]);

  useEffect(() => {
    if (!file || !onSave || draft === savedRef.current) return;
    const timer = window.setTimeout(() => { void saveDraft(); }, 850);
    return () => window.clearTimeout(timer);
  }, [draft, file?.name, onSave, saveDraft]);

  const changeDraft = useCallback((content: string) => {
    draftRef.current = content;
    setDraft(content);
    setSaveState(content === savedRef.current ? "saved" : "dirty");
  }, []);

  function enterEditMode() {
    setEditorDocument(draft);
    setMode("edit");
  }

  const saveFromEditor = useCallback(() => { void saveDraft(); }, [saveDraft]);

  const saveLabel = saveState === "saving" ? "正在保存" : saveState === "dirty" ? "有未保存修改" : saveState === "error" ? "保存失败" : "已保存";
  return (
    <section className="document-workspace project-surface-enter" key={transitionKey}>
      <header className="document-commandbar">
        {failedSelection && <span className="document-failure-status"><WarningCircle size={14} weight="fill" />{blockedSelection ? "本次未生成" : "生成失败"}</span>}
        <div className="document-actions">
          {file && onSave && (
            <div className="document-view-switcher" role="group" aria-label="文档视图">
              <button type="button" className={mode === "edit" ? "active" : ""} onClick={enterEditMode}><PencilSimple size={15} weight="bold" />编辑</button>
              <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={15} weight="bold" />预览</button>
            </div>
          )}
          {file && onRefine && onRefineFeedbackChange && (
            <button className="secondary-button document-refine-toggle" type="button" onClick={() => setRefineOpen((open) => !open)} aria-expanded={refineOpen}>
              <MagicWand size={15} weight="fill" />修改
            </button>
          )}
          {file && onSave && (
            <button className="secondary-button document-save-button" type="button" disabled={saveState === "saving" || saveState === "saved"} onClick={() => void saveDraft()}>
              <FloppyDisk size={15} weight="bold" />{saveState === "saving" ? "保存中" : "保存"}
            </button>
          )}
          <button className="secondary-button" type="button" disabled={!file} onClick={onCopy}><Copy size={15} weight="bold" />复制正文</button>
          <details className="document-more-menu">
            <summary aria-label="更多操作" title="更多操作"><DotsThree size={20} weight="bold" /></summary>
            <div className="document-more-popover">
              <button className="export-control" data-export-current type="button" disabled={!file} onClick={onDownload}><DownloadSimple size={16} />导出当前文档</button>
              <button className="export-bundle-control" type="button" onClick={onDownloadAll}><Package size={16} />导出完整内容包</button>
              {canRegenerate && <button type="button" disabled={regenerating} onClick={onRegenerate}><ArrowClockwise size={16} />{regenerating ? "正在重新生成" : "重新生成异常文档"}</button>}
            </div>
          </details>
        </div>
      </header>
      {file && onRefine && onRefineFeedbackChange && (
        <div className={`document-refine-reveal${refineOpen ? " is-open" : ""}`} aria-hidden={!refineOpen}>
          <div className="document-refine-reveal-inner">
            <form className="document-refine-bar" onSubmit={onRefine}>
              <header className="document-refine-header">
                <span><MagicWand size={15} weight="fill" />修改</span>
                <button className="document-refine-close" type="button" onClick={() => setRefineOpen(false)} aria-label="收起修改面板">
                  <X size={15} weight="bold" />
                </button>
              </header>

              <label className="document-refine-field">
                <span className="sr-only">修改要求</span>
                <textarea
                  required
                  rows={2}
                  value={refineFeedback}
                  onChange={(event) => onRefineFeedbackChange(event.target.value)}
                  placeholder="输入修改要求，例如：前三秒更抓人，减少书面感。"
                />
              </label>

              <footer className="document-refine-footer">
                <div className="document-refine-submit">
                  <button className="primary-button" type="submit" disabled={refining}>
                    <MagicWand size={15} weight="fill" />{refining ? "生成中…" : "生成修改版"}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}
      {error && <div className="product-alert alert-warning" role="alert"><span>!</span><div><strong>执行提示</strong><p>{error}</p></div></div>}
      {notice && (
        <div className="document-success-alert" role="status">
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          <div className="document-success-copy">
            <strong>{noticeDetails.length ? "修复完成" : "操作已完成"}</strong>
            <span>{noticeDetails.length ? `已修复 ${noticeDetails.length} 项，已通过复检` : notice}</span>
          </div>
          {onNoticeConfirm && (
            <button className="document-success-confirm" type="button" onClick={onNoticeConfirm}>
              <Check size={14} weight="bold" />确认
            </button>
          )}
        </div>
      )}
      {saveError && <div className="product-alert alert-warning" role="alert"><span>!</span><div><strong>未能保存修改</strong><p>{saveError}</p></div></div>}
      {file?.validationErrors && file.validationErrors.length > 0 && (
        <div className="product-alert alert-warning document-validation-alert" role="alert">
          <span>!</span>
          <div className="document-validation-content">
            <div className="document-validation-copy">
              <strong>当前文档未通过校验</strong>
              <p>{file.validationErrors.join("；")}</p>
            </div>
            {onRepair && (
              <div className="document-validation-action">
                <button
                  className="primary-button document-auto-repair"
                  type="button"
                  disabled={repairing || saveState !== "saved"}
                  onClick={onRepair}
                  title={saveState !== "saved" ? "请等待当前修改保存完成后再自动修复" : "系统将根据校验原因修复并复检，原版本会保留"}
                >
                  <MagicWand size={15} weight="fill" />{repairing ? "正在修复…" : "一键修复"}
                </button>
                <small>自动修复并复检，原版本会保留</small>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="canvas-stage">
        {file ? (
          mode === "edit" && onSave ? (
            <div className="document-editor-shell">
              <RichMarkdownEditor initialMarkdown={editorDocument} onChange={changeDraft} onSave={saveFromEditor} />
              <span className="document-editor-hint">所见即所得 · ⌘S 保存 · 停止输入后自动保存</span>
            </div>
          ) : <div className="markdown-canvas"><MarkdownPreview content={draft || file.content} /></div>
        ) : failedSelection ? (
          <section className="document-failure-view" aria-labelledby="document-failure-title">
            <span className="document-failure-icon"><WarningCircle size={24} weight="fill" /></span>
            <p className="document-failure-kicker">{blockedSelection ? "该文档未进入生成" : "该文档生成后未通过校验"}</p>
            <h3 id="document-failure-title">{selectedFileName}</h3>
            <div className="document-failure-reason">
              <strong>{blockedSelection ? "未生成原因" : "生成失败原因"}</strong>
              {failureReasons.map((reason) => <p key={reason}>{reason}</p>)}
            </div>
            <p className="document-failure-guidance">{dependencyFailure ? "需要先让上游文档通过校验，系统才会继续生成当前文档。" : "原因已记录；重新生成只处理当前失败项，不覆盖其他已完成文档。"}</p>
            <button className="primary-button document-retry-button" type="button" disabled={regenerating} onClick={onRetrySelected}>
              <ArrowClockwise size={17} weight="bold" />{regenerating ? "正在重新生成" : dependencyFailure ? "从失败文档继续生成" : "重新生成当前文档"}
            </button>
          </section>
        ) : (
          <div className="empty-card">项目中没有 Markdown 文件。</div>
        )}
      </div>
      <footer className={`document-statusbar document-save-state is-${saveState}`}>{failedSelection ? "尚未生成" : <><i />{saveLabel}</>}</footer>
    </section>
  );
}
