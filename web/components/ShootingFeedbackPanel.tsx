"use client";

import { useEffect, useState } from "react";
import type { ShotTask } from "../../src/types/shotTask";
import type { FeedbackRevision, ShotActualOutcome, ShotActualRecord, ShootingFeedback } from "../../src/types/shootingFeedback";
import { readJsonResponse } from "../lib/readJsonResponse";
import { promptForModelConfig, withLocalModelConfig } from "../lib/localModelConfig";

interface ShootingFeedbackPanelProps {
  slug: string;
  shotTasks: ShotTask[];
  onChanged?: () => void;
}

interface DraftFeedback {
  id?: string;
  title: string;
  shootDate: string;
  location: string;
  shotRecords: ShotActualRecord[];
  addedShotsText: string;
  issuesText: string;
  overallNote: string;
  scriptAdjustments: string;
  storyboardAdjustments: string;
  checklistAdjustments: string;
}

const OUTCOME_LABELS: Record<ShotActualOutcome, string> = {
  used: "实际使用",
  removed: "现场删掉",
  reshoot: "需要补拍",
  not_shot: "未拍",
};

function newDraft(tasks: ShotTask[], feedback?: ShootingFeedback): DraftFeedback {
  return {
    id: feedback?.id,
    title: feedback?.title || "",
    shootDate: feedback?.shootDate || new Date().toISOString().slice(0, 10),
    location: feedback?.location || "",
    shotRecords: feedback?.shotRecords?.length ? feedback.shotRecords : tasks.map((task) => ({
      shotTaskId: task.id,
      order: task.order,
      label: task.visualDescription,
      plannedDurationSeconds: task.durationSeconds,
      outcome: task.status === "done" || task.status === "shot" ? "used" : "not_shot",
      note: task.notes || "",
    })),
    addedShotsText: feedback?.addedShots.map((shot) => `${shot.label}${shot.reason ? `｜${shot.reason}` : ""}`).join("\n") || "",
    issuesText: feedback?.onSetIssues.join("\n") || "",
    overallNote: feedback?.overallNote || "",
    scriptAdjustments: feedback?.scriptAdjustments || "",
    storyboardAdjustments: feedback?.storyboardAdjustments || "",
    checklistAdjustments: feedback?.checklistAdjustments || "",
  };
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function ShootingFeedbackPanel({ slug, shotTasks, onChanged }: ShootingFeedbackPanelProps) {
  const [feedbacks, setFeedbacks] = useState<ShootingFeedback[]>([]);
  const [draft, setDraft] = useState<DraftFeedback>(() => newDraft(shotTasks));
  const [revision, setRevision] = useState<FeedbackRevision | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "revise" | "">("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(slug)}/feedback`, { cache: "no-store" })
      .then(async (res) => {
        const data = await readJsonResponse<{ feedback?: ShootingFeedback[]; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "拍摄复盘读取失败。");
        if (!active) return;
        const items = data.feedback || [];
        setFeedbacks(items);
        if (items[0]) setDraft(newDraft(shotTasks, items[0]));
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "拍摄复盘读取失败。"));
    return () => { active = false; };
  }, [slug, shotTasks]);

  function patchDraft(patch: Partial<DraftFeedback>) {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice("");
    setError("");
  }

  function patchRecord(order: number, patch: Partial<ShotActualRecord>) {
    patchDraft({ shotRecords: draft.shotRecords.map((record) => record.order === order ? { ...record, ...patch } : record) });
  }

  async function save() {
    setBusy("save"); setNotice(""); setError(""); setRevision(null);
    try {
      const addedShots = splitLines(draft.addedShotsText).map((line) => {
        const [label, reason] = line.split("｜", 2);
        return { label: label.trim(), reason: reason?.trim() };
      }).filter((item) => item.label);
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          title: draft.title || "拍摄复盘",
          shootDate: draft.shootDate,
          location: draft.location,
          shotRecords: draft.shotRecords,
          addedShots,
          onSetIssues: splitLines(draft.issuesText),
          overallNote: draft.overallNote,
          scriptAdjustments: draft.scriptAdjustments,
          storyboardAdjustments: draft.storyboardAdjustments,
          checklistAdjustments: draft.checklistAdjustments,
        }),
      });
      const data = await readJsonResponse<{ feedback?: ShootingFeedback; error?: string }>(res);
      if (!res.ok || !data.feedback) throw new Error(data.error || "拍摄复盘保存失败。");
      setDraft(newDraft(shotTasks, data.feedback));
      setFeedbacks((current) => [data.feedback!, ...current.filter((item) => item.id !== data.feedback!.id)]);
      setNotice("拍摄复盘已保存，计划与实际的差异已经记录。");
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "拍摄复盘保存失败。");
    } finally { setBusy(""); }
  }

  async function generateRevision() {
    if (!draft.id) {
      setError("请先保存拍摄复盘，再生成下一版内容。");
      return;
    }
    setBusy("revise"); setNotice(""); setError("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/feedback/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withLocalModelConfig({ feedbackId: draft.id })),
      });
      const data = await readJsonResponse<{ revision?: FeedbackRevision; error?: string; errorCode?: string }>(res);
      if (!res.ok || !data.revision) {
        promptForModelConfig(data.errorCode);
        throw new Error(data.error || "下一版内容生成失败。");
      }
      setRevision(data.revision);
      setNotice("下一版脚本、分镜、拍摄清单和成片执行稿已生成，原文件未覆盖。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "下一版内容生成失败。");
    } finally { setBusy(""); }
  }

  async function applyRevision() {
    if (!revision) return;
    setBusy("revise"); setNotice(""); setError("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/feedback/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: revision.id }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "应用修订版本失败。");
      setNotice("修订版本已应用，镜头任务已重建并保留现场状态。");
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用修订版本失败。");
    } finally { setBusy(""); }
  }

  return (
    <section className="shooting-feedback-panel">
      <div className="shooting-feedback-header">
        <div>
          <h3>拍摄复盘</h3>
        </div>
        <div className="shooting-feedback-actions">
          {feedbacks.length > 0 && (
            <select value={draft.id || ""} onChange={(event) => {
              const item = feedbacks.find((feedback) => feedback.id === event.target.value);
              if (item) setDraft(newDraft(shotTasks, item));
            }} aria-label="选择历史复盘">
              <option value="">当前复盘</option>
              {feedbacks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          )}
          <button type="button" className="secondary-button" onClick={() => setDraft(newDraft(shotTasks))}>新建复盘</button>
        </div>
      </div>

      <div className="shooting-feedback-table-wrap">
        <table className="shooting-feedback-table">
          <thead><tr><th>镜头</th><th>现场结果</th><th>问题 / 备注</th></tr></thead>
          <tbody>{draft.shotRecords.map((record) => (
            <tr key={`${record.shotTaskId}-${record.order}`}>
              <td><strong>#{String(record.order).padStart(2, "0")}</strong><small>{record.label || "镜头"}</small></td>
              <td><select value={record.outcome} onChange={(e) => patchRecord(record.order, { outcome: e.target.value as ShotActualOutcome })}>{Object.entries(OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
              <td><input value={record.issue || record.note || ""} onChange={(e) => patchRecord(record.order, { issue: e.target.value })} placeholder="现场问题、删镜原因或补拍说明" /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="shooting-feedback-grid">
        <label><span>新增镜头</span><textarea rows={3} value={draft.addedShotsText} onChange={(e) => patchDraft({ addedShotsText: e.target.value })} placeholder="一行一条：镜头｜原因" /></label>
        <label><span>现场问题</span><textarea rows={3} value={draft.issuesText} onChange={(e) => patchDraft({ issuesText: e.target.value })} placeholder="一行一条" /></label>
        <label><span>下一版调整</span><textarea rows={3} value={draft.overallNote} onChange={(e) => patchDraft({ overallNote: e.target.value })} placeholder="保留什么、修正什么" /></label>
      </div>

      {error && <div className="product-alert alert-warning"><span>!</span><p>{error}</p></div>}
      {notice && <div className="product-alert alert-success"><span>✓</span><p>{notice}</p></div>}
      {revision && <div className="feedback-revision-result"><strong>下一版已生成</strong><button type="button" className="secondary-button" disabled={busy !== ""} onClick={applyRevision}>应用到项目</button></div>}

      <div className="shooting-feedback-footer">
        <div><button type="button" className="secondary-button" disabled={busy !== ""} onClick={save}>{busy === "save" ? "保存中…" : "保存"}</button><button type="button" className="primary-button" disabled={busy !== "" || !draft.id} onClick={generateRevision}>{busy === "revise" ? "生成中…" : "生成下一版"}</button></div>
      </div>
    </section>
  );
}
