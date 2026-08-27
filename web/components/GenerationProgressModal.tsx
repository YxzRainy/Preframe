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

export type GenerationProgressStatus = "waiting" | "generating" | "validating" | "completed" | "repairing" | "failed";

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
  repairing: "修复中",
  failed: "生成失败",
};

const WAITING_PROMPTS = [
  "正在把选题拆成可执行的内容项目...",
  "正在给你的脚本去 AI 味...",
  "正在检查标题有没有夸张承诺...",
  "正在整理拍摄和剪辑需要的关键信息...",
  "正在把零散想法压缩成 10 份 Markdown...",
  "慢一点没关系，正在尽量让内容更能直接使用...",
  "正在生成更像真人创作者会用的表达...",
  "正在补全发布后的评论区承接话术...",
];

const DOCUMENT_HINTS: Record<string, string> = {
  "01_项目概览.md": "正在把选题整理成可执行的项目骨架。",
  "02_选题拆解.md": "正在拆用户痛点和内容切入角度。",
  "03_口播脚本.md": "正在把口播改得更像人话。",
  "04_分镜与剪辑节奏.md": "正在把画面、字幕和剪辑节奏对齐。",
  "05_拍摄清单.md": "正在整理拍摄现场真正需要准备的东西。",
  "06_封面标题与发布文案.md": "正在检查标题有没有夸张承诺。",
  "07_视觉参考提示词.md": "正在把视觉方向写得更方便直接给工具使用。",
  "08_内容质检报告.md": "正在检查 AI 味、平台风险和可替换表达。",
  "09_成片执行稿.md": "正在把前期策划收束成可拍的执行稿。",
  "10_发布承接话术.md": "正在补全发布后的评论区和私信承接。",
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
  return (
    <Modal
      open={open}
      title="正在生成前期策划包"
      description="正在逐份生成 10 份本地 Markdown 文档。"
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
        <p className="generation-waiting-tip">小提示：{hint}</p>
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
