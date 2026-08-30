"use client";

import { Modal } from "./Modal";

export type MigrationProgressStage = "preparing" | "generating" | "validating" | "archiving" | "writing" | "completed";

export interface MigrationProgressView {
  stage: MigrationProgressStage;
  progress: number;
  documentId?: string;
  fileName?: string;
  message: string;
}

interface MigrationProgressModalProps {
  open: boolean;
  progress: MigrationProgressView;
}

const STEPS = [
  { id: "preparing", title: "读取历史项目", description: "确认旧文档与迁移条件" },
  { id: "generating", title: "生成新版工作稿", description: "依次生成三份核心文档" },
  { id: "validating", title: "自动质量校验", description: "全部通过后才会写入" },
  { id: "archiving", title: "归档旧文档", description: "保留在 .versions/ 中" },
  { id: "writing", title: "切换新版工作流", description: "写入工作稿并重建镜头任务" },
] as const;

function stageIndex(stage: MigrationProgressStage): number {
  if (stage === "completed") return STEPS.length;
  return STEPS.findIndex((item) => item.id === stage);
}

export function initialMigrationProgress(): MigrationProgressView {
  return { stage: "preparing", progress: 3, message: "正在检查历史项目与迁移条件。" };
}

export function MigrationProgressModal({ open, progress }: MigrationProgressModalProps) {
  const currentIndex = stageIndex(progress.stage);
  const completed = progress.stage === "completed" ? STEPS.length : currentIndex;
  const activeTitle = progress.fileName || STEPS[Math.max(currentIndex, 0)]?.title || "准备中";
  return (
    <Modal
      open={open}
      title="正在迁移到新版工作流"
      description="迁移完成前，历史项目文件不会被删除或覆盖。"
      onClose={() => undefined}
      closeDisabled
      size="md"
      className="migration-progress-modal"
    >
      <section className="migration-progress-panel" aria-live="polite">
        <div className="migration-progress-head">
          <span>迁移进度</span>
          <strong>{Math.max(0, Math.min(100, Math.round(progress.progress)))}%</strong>
        </div>
        <div className="migration-progressbar" role="progressbar" aria-label="项目迁移进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress)}>
          <i style={{ width: `${Math.max(3, Math.min(100, progress.progress))}%` }} />
        </div>
        <div className="migration-current-stage">
          <span className="spinner" aria-hidden="true" />
          <div><small>当前处理</small><strong>{activeTitle}</strong></div>
        </div>
        <p className="migration-progress-message">{progress.message}</p>
        <ol className="migration-step-list">
          {STEPS.map((step, index) => {
            const status = index < completed ? "completed" : index === currentIndex && progress.stage !== "completed" ? "active" : "waiting";
            return (
              <li className={`migration-step status-${status}`} key={step.id}>
                <i>{status === "completed" ? "✓" : index + 1}</i>
                <div><strong>{step.title}</strong><span>{step.description}</span></div>
                <em>{status === "completed" ? "已完成" : status === "active" ? "进行中" : "等待中"}</em>
              </li>
            );
          })}
        </ol>
        <p className="migration-safety-note">安全保障：只有三份新版文档都通过质量门，系统才会归档并移除项目根目录中的旧文档。</p>
      </section>
    </Modal>
  );
}
