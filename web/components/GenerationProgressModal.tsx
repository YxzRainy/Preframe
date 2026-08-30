"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";
import { formatDuration } from "../../src/utils/generationTiming";

export type GenerationUiStatus =
  | "idle"
  | "creating"
  | "generatingCore"
  | "generatingExecution"
  | "generatingPublishCopy"
  | "writing"
  | "paused"
  | "partial"
  | "completed"
  | "cancelled"
  | "failed";

export interface GenerationJobView {
  jobId: string;
  status: GenerationUiStatus;
  currentDocument: string;
  progress: number;
  message?: string;
  generationProgress?: GenerationProgressItem[];
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  durationLabel?: string;
}

export type GenerationProgressStatus = "waiting" | "generating" | "validating" | "completed" | "repairing" | "failed" | "blocked";

export interface GenerationProgressItem {
  id: string;
  title: string;
  fileName: string;
  status: GenerationProgressStatus;
  message?: string;
}

interface GenerationProgressModalProps {
  open: boolean;
  job: GenerationJobView;
  progressItems: GenerationProgressItem[];
  startedAt: number | null;
  endedAt: number | null;
  onCancel: () => void;
  cancelling: boolean;
  onPause: () => void;
  onResume: () => void;
  pausing: boolean;
}

const STATUS_LABELS: Record<GenerationProgressStatus, string> = {
  waiting: "等待中",
  generating: "生成中",
  validating: "校验中",
  completed: "已完成",
  repairing: "自动纠错中",
  failed: "生成失败",
  blocked: "未生成",
};

const WAITING_PROMPTS = [
  "正在把选题收束成一套一致的执行方案...",
  "正在建立目标时长、必保留项和禁用表达...",
  "正在检查逐字稿能不能直接念、直接拍...",
  "正在把口播、画面、字幕和素材合进同一张表...",
  "正在自动修复跨文档口径冲突...",
  "正在准备发布卡和真实数据复盘位置...",
];

const DOCUMENT_HINTS: Record<string, string> = {
  "01_创作简报.md": "正在确定唯一创作约束：用户、观点、时长和风险边界。",
  "02_拍摄执行稿.md": "正在生成唯一锁稿口径，并对齐口播、镜头、字幕和素材。",
  "03_发布与复盘.md": "正在收束最终标题、发布文案和发布后的数据回收。",
};

export function initialGenerationProgress(): GenerationProgressItem[] {
  return PROJECT_DOCUMENT_DEFINITIONS.map((definition) => ({
    id: definition.number,
    title: definition.title,
    fileName: definition.filename,
    status: "waiting",
  }));
}

export function progressFromFiles(fileNames: string[], failedFileName?: string): GenerationProgressItem[] {
  const fileSet = new Set(fileNames);
  return initialGenerationProgress().map((item) => {
    if (failedFileName && item.fileName === failedFileName) return { ...item, status: "failed" };
    return fileSet.has(item.fileName) ? { ...item, status: "completed" } : item;
  });
}

function countCompleted(items: GenerationProgressItem[]): number {
  return items.filter((item) => item.status === "completed").length;
}

function activeItem(items: GenerationProgressItem[], job: GenerationJobView): GenerationProgressItem | undefined {
  return items.find((item) => item.status === "generating" || item.status === "validating" || item.status === "repairing")
    || items.find((item) => item.fileName === job.currentDocument)
    || items.find((item) => item.status === "failed")
    || items.find((item) => item.status === "blocked")
    || items.find((item) => item.status === "waiting")
    || items[items.length - 1];
}

function useElapsedLabel(open: boolean, startedAt: number | null, endedAt: number | null): string {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<number>(() => 0);

  useEffect(() => {
    setMounted(true);
    if (!open || !startedAt || endedAt) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [endedAt, open, startedAt]);

  if (!startedAt) return "00:00";
  const endTs = endedAt || (mounted ? now : startedAt);
  return formatDuration(endTs - startedAt);
}

function useRotatingPrompt(open: boolean, fileName?: string): string {
  const [index, setIndex] = useState(0);
  const prompts = fileName && DOCUMENT_HINTS[fileName]
    ? [DOCUMENT_HINTS[fileName], ...WAITING_PROMPTS]
    : WAITING_PROMPTS;

  useEffect(() => {
    setIndex(0);
  }, [fileName]);

  useEffect(() => {
    if (!open) {
      setIndex(0);
      return;
    }
    const delay = [8000, 10000, 12000, 9000, 11000][index % 5];
    const timeout = window.setTimeout(() => setIndex((current) => current + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [index, open]);

  return prompts[index % prompts.length];
}

export function GenerationProgressModal({ open, job, progressItems, startedAt, endedAt, onCancel, cancelling, onPause, onResume, pausing }: GenerationProgressModalProps) {
  const items = progressItems.length ? progressItems : initialGenerationProgress();
  const completedCount = countCompleted(items);
  const totalCount = items.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const current = activeItem(items, job);
  const elapsedLabel = useElapsedLabel(open, startedAt, endedAt);
  const hint = useRotatingPrompt(open, current?.fileName);
  const diagnostic = current?.message && current.status !== "waiting" && current.status !== "completed" && current.status !== "validating"
    ? current.message
    : "";
  const diagnosticTitle = current?.status === "repairing"
    ? "首次生成未通过校验"
    : current?.status === "generating"
      ? "上一次模型调用失败"
      : current?.status === "blocked"
        ? "本次未生成原因"
        : "生成失败原因";
  return (
    <Modal
      open={open}
      title="正在生成核心工作稿"
      description="正在顺序生成 3 份互相一致的本地核心工作稿。"
      onClose={() => undefined}
      closeDisabled
      size="md"
      footer={(
        <div className="generation-modal-actions">
          <button className="secondary-button" type="button" onClick={job.status === "paused" ? onResume : onPause} disabled={pausing || cancelling}>
            {pausing ? "处理中" : job.status === "paused" ? "继续生成" : "暂停"}
          </button>
          <button className="secondary-button danger" type="button" onClick={onCancel} disabled={cancelling || job.status === "cancelled"}>{cancelling ? "正在撤销" : "撤销生成"}</button>
        </div>
      )}
    >
      <div className="generation-progress-panel">
        <div className="generation-timer-row">
          <span>已用时</span>
          <strong>{elapsedLabel}</strong>
        </div>
        <div className="generation-progress-meta">
          <span>总进度</span>
          <strong>{completedCount}/{totalCount}</strong>
        </div>
        <div className="generation-progressbar" aria-label="生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} role="progressbar">
          <i style={{ width: `${progress}%` }} />
        </div>
        <p className="generation-current-doc">{job.status === "paused" ? "已暂停于：" : "正在生成："}<strong>{current?.fileName || "准备中"}</strong></p>
        {diagnostic ? (
          <div className={`generation-diagnostic status-${current?.status}`} role="status">
            <strong>{diagnosticTitle}</strong>
            <span>{diagnostic}</span>
            {current?.status === "repairing" && <small>系统正在根据这条原因自动纠错，纠错完成后会重新校验。</small>}
            {current?.status === "generating" && <small>系统正在自动重试模型调用。</small>}
          </div>
        ) : <p className="generation-waiting-tip">小提示：{hint}</p>}
        <ol className="generation-document-list">
          {items.map((item) => {
            const active = item.fileName === current?.fileName && (item.status === "generating" || item.status === "validating" || item.status === "repairing");
            return (
              <li className={`generation-document-item status-${item.status} ${active ? "active" : ""}`} key={item.fileName}>
                <i>{item.id}</i>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.fileName}</span>
                </div>
                <em>{STATUS_LABELS[item.status]}</em>
              </li>
            );
          })}
        </ol>
        {job.message && <p className="generation-progress-message">{job.message}</p>}
      </div>
    </Modal>
  );
}
