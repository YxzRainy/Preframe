"use client";

import { Camera, CaretLeft, CaretRight, CheckCircle, Flag, Star, WarningDiamond } from "@phosphor-icons/react";
import type { ShotTake, ShotTakeOutcome, ShotTask } from "../../src/types/shotTask";

const OUTCOME: Record<ShotTakeOutcome, { label: string; className: string }> = {
  good: { label: "满意", className: "good" },
  usable: { label: "可用", className: "usable" },
  reshoot: { label: "补拍", className: "reshoot" },
};

export function ShootingMode({
  tasks,
  selectedId,
  saving,
  onSelect,
  onPatch,
}: {
  tasks: ShotTask[];
  selectedId: string;
  saving: boolean;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<ShotTask>) => void;
}) {
  const index = Math.max(0, tasks.findIndex((task) => task.id === selectedId));
  const task = tasks[index];
  if (!task) return <div className="shooting-mode-empty">先生成镜头任务，才能进入拍摄模式。</div>;
  const takes = task.takes || [];

  function record(outcome: ShotTakeOutcome) {
    const take: ShotTake = { id: `take_${Date.now().toString(36)}`, createdAt: new Date().toISOString(), outcome };
    onPatch(task.id, {
      takes: [...takes, take],
      ...(outcome === "reshoot" ? { needsReshoot: true } : { status: task.status === "todo" || task.status === "ready" ? "shot" : task.status, needsReshoot: false }),
      ...(outcome === "good" ? { bestTakeId: take.id } : {}),
    });
  }

  return (
    <section className="shooting-mode" aria-label="现场拍摄模式">
      <header className="shooting-mode-header">
        <div><span>现场拍摄</span><strong>镜头 {String(task.order).padStart(2, "0")} / {String(tasks.length).padStart(2, "0")}</strong></div>
        <div className="shooting-mode-nav">
          <button type="button" disabled={index === 0} onClick={() => onSelect(tasks[index - 1].id)} aria-label="上一个镜头"><CaretLeft size={20} weight="bold" /></button>
          <button type="button" disabled={index === tasks.length - 1} onClick={() => onSelect(tasks[index + 1].id)} aria-label="下一个镜头"><CaretRight size={20} weight="bold" /></button>
        </div>
      </header>
      <div className="shooting-mode-body">
        <p className="shooting-mode-kind">{task.shotType || "标准镜头"}{task.durationSeconds ? ` · 约 ${task.durationSeconds} 秒` : ""}</p>
        <div className="shooting-prompt-card">
          <span>提词</span>
          <p>{task.narration || "此镜头无需口播，按画面说明完成拍摄。"}</p>
        </div>
        <div className="shooting-visual-card"><span>画面</span><p>{task.visualDescription || "未提供画面说明。"}</p></div>
        {task.notes && <p className="shooting-notes"><Flag size={14} weight="fill" />{task.notes}</p>}
      </div>
      <footer className="shooting-mode-footer">
        <div className="take-summary"><Camera size={16} weight="fill" /><span>{takes.length ? `已记 ${takes.length} take` : "尚未记录 take"}</span>{task.needsReshoot && <b><WarningDiamond size={14} weight="fill" />需补拍</b>}</div>
        <div className="take-actions">
          <button type="button" disabled={saving} className="take-action reshoot" onClick={() => record("reshoot")}><WarningDiamond size={16} weight="fill" />补拍</button>
          <button type="button" disabled={saving} className="take-action usable" onClick={() => record("usable")}><CheckCircle size={16} weight="fill" />可用</button>
          <button type="button" disabled={saving} className="take-action good" onClick={() => record("good")}><Star size={16} weight="fill" />最佳 take</button>
        </div>
      </footer>
      {takes.length > 0 && <div className="take-history" aria-label="Take 记录">{takes.slice().reverse().map((take, position) => <button type="button" key={take.id} className={`${OUTCOME[take.outcome].className}${task.bestTakeId === take.id ? " selected" : ""}`} onClick={() => onPatch(task.id, { bestTakeId: take.id, needsReshoot: take.outcome === "reshoot" })}><span>Take {takes.length - position}</span><b>{task.bestTakeId === take.id ? <Star size={13} weight="fill" /> : null}{OUTCOME[take.outcome].label}</b></button>)}</div>}
    </section>
  );
}
