"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../Modal";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  PUBLISHER_PLATFORM_LABELS,
  type PublisherAccount,
} from "../../../src/types/publisher";

interface CreateJobModalProps {
  open: boolean;
  onClose: () => void;
  presetProjectSlug?: string;
  accounts: PublisherAccount[];
  onCreated: () => void;
}

interface VideoInfo {
  path: string;
  name: string;
  sizeLabel: string;
}

interface TargetDraft {
  title: string;
  description: string;
  tagsStr: string;
  thumbnailPath: string;
  included: boolean;
}

interface ProjectFile {
  name: string;
  content: string;
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，\n、\s]+/u)
    .map((t) => t.replace(/^#+/u, "").trim())
    .filter(Boolean);
}

function section(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)#{1,6}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, "iu");
  return pattern.exec(content)?.[1]?.trim() ?? "";
}

function firstLine(text: string): string {
  const line = text.split(/\n/u).find((l) => l.trim());
  if (!line) return "";
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").replace(/^#+\s*/u, "").trim();
}

/** 从 06/10 文档保守提取标题/文案/标签；失败保持空白 */
function extractProjectContent(files: ProjectFile[]): { title: string; description: string; tagsStr: string } {
  const doc06 = files.find((f) => /^06_封面标题与发布文案/u.test(f.name));
  const doc10 = files.find((f) => /^10_发布承接话术/u.test(f.name));
  let title = "";
  let description = "";
  let tagsStr = "";
  if (doc06) {
    title = firstLine(section(doc06.content, "标题候选")) || firstLine(section(doc06.content, "推荐标题"));
    description = section(doc06.content, "抖音发布文案") || section(doc06.content, "小红书发布文案") || section(doc06.content, "发布文案");
    const tagBlock = section(doc06.content, "标签建议") || section(doc06.content, "标签");
    const hashtags = tagBlock.match(/#[^\s#,，、]+/gu) || [];
    tagsStr = hashtags.length ? hashtags.join(", ") : tagBlock.split(/\n/u).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim()).filter(Boolean).join(", ");
  }
  if (!description && doc10) {
    description = section(doc10.content, "承接话术") || section(doc10.content, "话术") || firstLine(doc10.content);
  }
  return { title, description, tagsStr };
}

const STEPS = ["选择成片", "选择账号", "填写内容", "保存任务"] as const;

export function CreateJobModal({ open, onClose, presetProjectSlug, accounts, onCreated }: CreateJobModalProps) {
  const [step, setStep] = useState(0);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [master, setMaster] = useState({ title: "", description: "", tagsStr: "", thumbnailPath: "" });
  const [targets, setTargets] = useState<Record<string, TargetDraft>>({});
  const [saving, setSaving] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const enabledAccounts = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);

  // 打开时重置 / 预填项目内容
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setVideo(null);
    setSelectedIds(new Set());
    setMaster({ title: "", description: "", tagsStr: "", thumbnailPath: "" });
    setTargets({});
    setError("");
    setNotice("");
    if (presetProjectSlug) {
      setLoadingProject(true);
      fetch(`/api/projects/${encodeURIComponent(presetProjectSlug)}`)
        .then(async (res) => {
          const data = await readJsonResponse<{ project?: { files?: ProjectFile[] }; error?: string }>(res);
          if (!res.ok) throw new Error(data.error || "项目读取失败。");
          const files = (data.project?.files || []) as ProjectFile[];
          const extracted = extractProjectContent(files);
          setMaster((m) => ({
            ...m,
            title: extracted.title || m.title,
            description: extracted.description || m.description,
            tagsStr: extracted.tagsStr || m.tagsStr,
          }));
          setNotice(extracted.title ? `已从项目文档预填标题与文案` : "未在项目中找到 06/10 文档，请手动填写。");
        })
        .catch(() => setNotice("项目内容读取失败，请手动填写。"))
        .finally(() => setLoadingProject(false));
    }
  }, [open, presetProjectSlug]);

  async function pickVideo() {
    setError("");
    setPicking(true);
    try {
      const res = await fetch("/api/publisher/pick-video", { method: "POST" });
      const data = await readJsonResponse<{ data?: { videoPath?: string; name?: string; sizeLabel?: string; canceled?: boolean }; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "视频选择失败。");
      if (data.data?.canceled) { setPicking(false); return; }
      if (data.data?.videoPath) {
        setVideo({
          path: data.data.videoPath,
          name: data.data.name || data.data.videoPath,
          sizeLabel: data.data.sizeLabel || "",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频选择失败。");
    } finally {
      setPicking(false);
    }
  }

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(enabledAccounts.map((a) => a.id)));
  }

  function ensureTargetsForSelection() {
    setTargets((prev) => {
      const next: Record<string, TargetDraft> = {};
      for (const id of selectedIds) {
        next[id] = prev[id] ?? { title: master.title, description: master.description, tagsStr: master.tagsStr, thumbnailPath: master.thumbnailPath, included: true };
      }
      return next;
    });
  }

  function applyMasterToAll() {
    setTargets((prev) => {
      const next: Record<string, TargetDraft> = {};
      for (const id of selectedIds) {
        next[id] = { ...(prev[id] ?? { included: true }), title: master.title, description: master.description, tagsStr: master.tagsStr, thumbnailPath: master.thumbnailPath };
      }
      return next;
    });
  }

  function patchTarget(id: string, patch: Partial<TargetDraft>) {
    setTargets((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { title: "", description: "", tagsStr: "", thumbnailPath: "", included: true }), ...patch } }));
  }

  function next() {
    setError("");
    if (step === 0 && !video) { setError("请先选择成片视频。"); return; }
    if (step === 1 && selectedIds.size === 0) { setError("至少选择一个账号。"); return; }
    if (step === 1) ensureTargetsForSelection();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function save() {
    setError("");
    if (!video) { setError("缺少视频。"); return; }
    const includedTargets = enabledAccounts
      .filter((a) => selectedIds.has(a.id) && targets[a.id]?.included)
      .map((a) => {
        const t = targets[a.id];
        return {
          accountId: a.id,
          platform: a.platform,
          title: t.title || master.title,
          description: t.description || master.description,
          tags: splitTags(t.tagsStr || master.tagsStr),
          thumbnailPath: t.thumbnailPath || master.thumbnailPath || undefined,
        };
      });
    if (includedTargets.length === 0) { setError("至少保留一个参与发布的账号。"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/publisher/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: presetProjectSlug,
          videoPath: video.path,
          thumbnailPath: master.thumbnailPath || undefined,
          masterContent: { title: master.title, description: master.description, tags: splitTags(master.tagsStr) },
          targets: includedTargets,
        }),
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "保存失败。");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  const selectedAccounts = enabledAccounts.filter((a) => selectedIds.has(a.id));

  return (
    <Modal
      open={open}
      title="创建发布任务"
      description={`步骤 ${step + 1} / ${STEPS.length} · ${STEPS[step]}`}
      onClose={onClose}
      size="lg"
      footer={
        <div className="publish-modal-footer">
          {error && <span className="publish-error">{error}</span>}
          <div className="publish-modal-footer-actions">
            {step > 0 && <button type="button" className="secondary-button" onClick={back}>上一步</button>}
            {step < STEPS.length - 1 ? (
              <button type="button" className="primary-button" onClick={next}>下一步</button>
            ) : (
              <button type="button" className="primary-button" disabled={saving} onClick={save}>
                {saving ? "保存中…" : "保存为草稿"}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="publish-stepper">
        {STEPS.map((label, i) => (
          <span key={label} className={i === step ? "active" : i < step ? "done" : ""}>{i + 1}. {label}</span>
        ))}
      </div>

      {notice && <p className="publish-notice">{notice}</p>}
      {loadingProject && <p className="publish-muted">正在读取项目文档…</p>}

      {step === 0 && (
        <div className="publish-step">
          <button type="button" className="secondary-button" disabled={picking} onClick={pickVideo}>
            {picking ? "选择中…" : "选择本地视频"}
          </button>
          <p className="publish-step-hint">支持 mp4 / mov / m4v / webm，仅记录本地绝对路径，不上传云端。</p>
          {video && (
            <div className="publish-video-info" title={video.path}>
              <strong>{video.name}</strong>
              <span>{video.sizeLabel}</span>
              <code>{video.path}</code>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="publish-step">
          <div className="publish-step-head">
            <span>选择参与的账号（可多选，同平台可同时选）</span>
            <button type="button" className="secondary-button" onClick={selectAll}>全选</button>
          </div>
          {enabledAccounts.length === 0 ? (
            <p className="publish-muted">没有已登录的账号，请先在「平台账号」中扫码连接。</p>
          ) : (
            <ul className="publish-account-pick">
              {enabledAccounts.map((acc) => {
                const checked = selectedIds.has(acc.id);
                return (
                  <li key={acc.id}>
                    <label className={checked ? "checked" : ""}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAccount(acc.id)} />
                      <span>
                        <strong>{acc.displayName}</strong>
                        <small>{PUBLISHER_PLATFORM_LABELS[acc.platform]}</small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="publish-step-hint">仅已登录账号可选；未登录账号需先在「平台账号」中扫码连接。</p>
        </div>
      )}

      {step === 2 && (
        <div className="publish-step">
          <div className="publish-master-form">
            <h3>母版内容</h3>
            <label><span>标题</span><input value={master.title} onChange={(e) => setMaster((m) => ({ ...m, title: e.target.value }))} /></label>
            <label><span>描述/文案</span><textarea rows={3} value={master.description} onChange={(e) => setMaster((m) => ({ ...m, description: e.target.value }))} /></label>
            <label><span>标签（逗号分隔）</span><input value={master.tagsStr} onChange={(e) => setMaster((m) => ({ ...m, tagsStr: e.target.value }))} /></label>
            <label><span>封面路径（可选）</span><input value={master.thumbnailPath} onChange={(e) => setMaster((m) => ({ ...m, thumbnailPath: e.target.value }))} /></label>
            <button type="button" className="secondary-button" onClick={applyMasterToAll}>应用母版到全部账号</button>
          </div>

          <div className="publish-targets-edit">
            <h3>各账号内容（默认复制母版，可独立修改）</h3>
            {selectedAccounts.map((acc) => {
              const t = targets[acc.id] ?? { title: master.title, description: master.description, tagsStr: master.tagsStr, thumbnailPath: master.thumbnailPath, included: true };
              return (
                <div key={acc.id} className="publish-target-edit">
                  <div className="publish-target-edit-head">
                    <label className="publish-include">
                      <input type="checkbox" checked={t.included} onChange={(e) => patchTarget(acc.id, { included: e.target.checked })} />
                      <strong>{acc.displayName}</strong>
                      <small>{PUBLISHER_PLATFORM_LABELS[acc.platform]}</small>
                    </label>
                  </div>
                  <input placeholder="独立标题" value={t.title} onChange={(e) => patchTarget(acc.id, { title: e.target.value })} />
                  <textarea rows={2} placeholder="独立描述/文案" value={t.description} onChange={(e) => patchTarget(acc.id, { description: e.target.value })} />
                  <input placeholder="独立标签（逗号分隔）" value={t.tagsStr} onChange={(e) => patchTarget(acc.id, { tagsStr: e.target.value })} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="publish-step">
          <div className="publish-summary">
            <div><span>成片</span><strong title={video?.path}>{video?.name}</strong></div>
            <div><span>账号数</span><strong>{selectedAccounts.filter((a) => targets[a.id]?.included).length}</strong></div>
            <div><span>母版标题</span><strong>{master.title || "（空）"}</strong></div>
            {presetProjectSlug && <div><span>关联项目</span><strong>{presetProjectSlug}</strong></div>}
          </div>
          <p className="publish-step-hint">保存为草稿，不执行真实发布。随后可在「待发布」中执行「发布前检查」。</p>
        </div>
      )}
    </Modal>
  );
}
