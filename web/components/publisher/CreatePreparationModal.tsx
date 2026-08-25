"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { readJsonResponse } from "../../lib/readJsonResponse";
import {
  PLATFORM_PUBLISH_PROFILES,
  PUBLISHER_PLATFORM_LABELS,
  PREPARATION_PLATFORMS,
  type PublisherPlatform,
} from "../../../src/types/publisher";

interface CreatePreparationModalProps {
  open: boolean;
  onClose: () => void;
  presetProjectSlug?: string;
  onCreated: () => void;
}

interface VideoInfo {
  path: string;
  name: string;
  sizeLabel: string;
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

const STEPS = ["选择成片", "选择平台", "填写母版", "创建任务"] as const;

export function CreatePreparationModal({ open, onClose, presetProjectSlug, onCreated }: CreatePreparationModalProps) {
  const [step, setStep] = useState(0);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PublisherPlatform>>(new Set());
  const [master, setMaster] = useState({ title: "", description: "", tagsStr: "", thumbnailPath: "" });
  const [saving, setSaving] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // 打开时重置 / 预填项目内容
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setVideo(null);
    setSelectedPlatforms(new Set());
    setMaster({ title: "", description: "", tagsStr: "", thumbnailPath: "" });
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
          setNotice(extracted.title ? "已从项目文档预填标题与文案" : "未在项目中找到 06/10 文档，请手动填写。");
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

  function togglePlatform(platform: PublisherPlatform) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  function next() {
    setError("");
    if (step === 0 && !video) { setError("请先选择成片视频。"); return; }
    if (step === 1 && selectedPlatforms.size === 0) { setError("至少选择一个目标平台。"); return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function save() {
    setError("");
    if (!video) { setError("缺少视频。"); return; }
    if (selectedPlatforms.size === 0) { setError("至少选择一个目标平台。"); return; }
    setSaving(true);
    try {
      const targets = Array.from(selectedPlatforms).map((platform) => ({
        platform,
        title: master.title,
        description: master.description,
        tags: splitTags(master.tagsStr),
        thumbnailPath: master.thumbnailPath || undefined,
        enabled: true,
      }));
      const res = await fetch("/api/publisher/preparations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: presetProjectSlug,
          videoPath: video.path,
          masterContent: {
            title: master.title,
            description: master.description,
            tags: splitTags(master.tagsStr),
            thumbnailPath: master.thumbnailPath || undefined,
          },
          targets,
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

  const selectedPlatformList = PREPARATION_PLATFORMS.filter((p) => selectedPlatforms.has(p));

  return (
    <Modal
      open={open}
      title="创建发布准备"
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
                {saving ? "保存中…" : "创建草稿"}
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
          <p className="publish-step-hint">支持 mp4 / mov / m4v / webm，仅记录本地绝对路径，不上传云端。无需连接平台账号即可创建发布准备。</p>
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
            <span>选择目标平台（可多选，无需连接账号）</span>
          </div>
          <ul className="publish-platform-pick">
            {PREPARATION_PLATFORMS.map((platform) => {
              const profile = PLATFORM_PUBLISH_PROFILES[platform];
              const checked = selectedPlatforms.has(platform);
              const statusText = profile.autoPublishStatus === "experimental"
                ? "自动化：实验性（未完成端到端验证）"
                : "自动化：未验证";
              return (
              <li key={platform}>
                <label className={checked ? "checked" : ""}>
                  <input type="checkbox" checked={checked} onChange={() => togglePlatform(platform)} />
                  <span>
                    <strong>{PUBLISHER_PLATFORM_LABELS[platform]}</strong>
                    <small>{statusText}</small>
                  </span>
                </label>
              </li>
              );
            })}
          </ul>
          <p className="publish-step-hint">发布准备不依赖平台账号。各平台文案可在创建后独立编辑、检查、导出。</p>
        </div>
      )}

      {step === 2 && (
        <div className="publish-step">
          <div className="publish-master-form">
            <h3>母版内容</h3>
            <p className="publish-step-hint">母版将作为各平台文案的初始内容，创建后可对每个平台独立修改。</p>
            <label><span>标题</span><input value={master.title} onChange={(e) => setMaster((m) => ({ ...m, title: e.target.value }))} /></label>
            <label><span>描述/文案</span><textarea rows={3} value={master.description} onChange={(e) => setMaster((m) => ({ ...m, description: e.target.value }))} /></label>
            <label><span>标签（逗号分隔）</span><input value={master.tagsStr} onChange={(e) => setMaster((m) => ({ ...m, tagsStr: e.target.value }))} /></label>
            <label><span>封面路径（可选）</span><input value={master.thumbnailPath} onChange={(e) => setMaster((m) => ({ ...m, thumbnailPath: e.target.value }))} /></label>
          </div>
          <p className="publish-step-hint">第一版不调用模型自动改写。创建后可：从母版复制 / 独立修改 / 重置为母版 / 一键复制该平台全部文案。</p>
        </div>
      )}

      {step === 3 && (
        <div className="publish-step">
          <div className="publish-summary">
            <div><span>成片</span><strong title={video?.path}>{video?.name}</strong></div>
            <div><span>目标平台</span><strong>{selectedPlatformList.map((p) => PUBLISHER_PLATFORM_LABELS[p]).join(" / ") || "（无）"}</strong></div>
            <div><span>母版标题</span><strong>{master.title || "（空）"}</strong></div>
            {presetProjectSlug && <div><span>关联项目</span><strong>{presetProjectSlug}</strong></div>}
          </div>
          <p className="publish-step-hint">创建为草稿，不执行真实发布。随后可执行「发布前检查」「导出发布包」「打开官方后台」。</p>
        </div>
      )}
    </Modal>
  );
}
