"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, SpinnerGap } from "@phosphor-icons/react";
import { readJsonResponse } from "../../lib/readJsonResponse";
import type { PublishData } from "../../../src/services/projectStage";
import type { PublishPreparation } from "../../../src/types/publisher";
import { CreatePreparationModal } from "../publisher/CreatePreparationModal";
import { PreparationEditor } from "../publisher/PreparationEditor";

interface PublishPanelProps {
  slug: string;
}

const EMPTY: PublishData = {};

export function PublishPanel({ slug }: PublishPanelProps) {
  const [data, setData] = useState<PublishData>(EMPTY);
  const [preparations, setPreparations] = useState<PublishPreparation[]>([]);
  const [activePreparationId, setActivePreparationId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [loadingPreparations, setLoadingPreparations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [publishRes, preparationsRes] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(slug)}/publish`, { cache: "no-store" }),
      fetch("/api/publisher/preparations", { cache: "no-store" }),
    ]);
    const [publishJson, preparationsJson] = await Promise.all([
      readJsonResponse<{ publishData?: PublishData; error?: string }>(publishRes),
      readJsonResponse<{ data?: { preparations?: PublishPreparation[] }; error?: string }>(preparationsRes),
    ]);
    if (!publishRes.ok) throw new Error(publishJson.error || "发布数据读取失败。");
    if (!preparationsRes.ok) throw new Error(preparationsJson.error || "发布准备读取失败。");
    const projectPreparations = (preparationsJson.data?.preparations || []).filter((item) => item.projectSlug === slug);
    setData(publishJson.publishData || EMPTY);
    setPreparations(projectPreparations);
    setActivePreparationId((current) => projectPreparations.some((item) => item.id === current) ? current : projectPreparations[0]?.id || "");
  }, [slug]);

  useEffect(() => {
    let active = true;
    setLoadingPreparations(true);
    load()
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "发布准备读取失败。"))
      .finally(() => active && setLoadingPreparations(false));
    return () => { active = false; };
  }, [load]);

  const activePreparation = useMemo(
    () => preparations.find((item) => item.id === activePreparationId) || preparations[0],
    [activePreparationId, preparations],
  );

  function set<K extends keyof PublishData>(key: K, value: PublishData[K]) {
    setData((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/publish`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await readJsonResponse<{ publishData?: PublishData; error?: string }>(response);
      if (!response.ok) throw new Error(json.error || "发布数据保存失败。");
      setData(json.publishData || EMPTY);
      setNotice("发布复盘已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布数据保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function refreshPreparations() {
    setCreateOpen(false);
    await load().catch((caught) => setError(caught instanceof Error ? caught.message : "发布准备刷新失败。"));
  }

  return (
    <section className="publish-panel" aria-label="发布准备与复盘">
      <header className="project-publish-header">
        <div>
          <h3>发布</h3>
          <p>准备内容、完成检查，然后记录已发布的视频。</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setCreateOpen(true)}>
          <Plus size={15} weight="bold" /> 新建发布准备
        </button>
      </header>

      {loadingPreparations ? (
        <div className="project-publish-loading"><SpinnerGap size={18} className="spin-icon" /> 正在读取发布准备</div>
      ) : preparations.length === 0 ? (
        <div className="project-publish-empty">
          <strong>还没有发布准备</strong>
          <span>选择成片和平台，开始整理可直接发布的内容。</span>
        </div>
      ) : (
        <div className="project-preparation-workspace">
          {preparations.length > 1 && (
            <label className="project-preparation-picker">
              <span>发布准备版本</span>
              <select value={activePreparation?.id || ""} onChange={(event) => setActivePreparationId(event.target.value)}>
                {preparations.map((preparation, index) => (
                  <option key={preparation.id} value={preparation.id}>
                    {index === 0 ? "最新 · " : ""}{new Date(preparation.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {activePreparation && <PreparationEditor preparation={activePreparation} onChanged={refreshPreparations} />}
        </div>
      )}

      <div className="project-review-section">
        <div className="project-review-heading">
          <span>发布记录</span>
          <p>录入发布时间后，项目会自动标为已发布。</p>
        </div>
        <div className="publish-panel-body">
          <div className="publish-row">
            <label>
              <span>发布平台</span>
              <input type="text" value={data.platform || ""} onChange={(event) => set("platform", event.target.value)} placeholder="例如：小红书" />
            </label>
            <label>
              <span>发布时间</span>
              <input type="datetime-local" value={data.publishedAt ? data.publishedAt.slice(0, 16) : ""} onChange={(event) => set("publishedAt", event.target.value ? new Date(event.target.value).toISOString() : undefined)} />
            </label>
          </div>
          <label>
            <span>发布链接</span>
            <input type="url" value={data.publishUrl || ""} onChange={(event) => set("publishUrl", event.target.value)} placeholder="https://" />
          </label>
          <details className="publish-optional-fields">
            <summary>补充表现数据（可选）</summary>
            <div className="publish-optional-body">
              <div className="publish-row publish-row-4">
                <label><span>播放</span><input type="number" min="0" value={data.views ?? ""} onChange={(event) => set("views", event.target.value ? Number(event.target.value) : undefined)} /></label>
                <label><span>点赞</span><input type="number" min="0" value={data.likes ?? ""} onChange={(event) => set("likes", event.target.value ? Number(event.target.value) : undefined)} /></label>
                <label><span>收藏</span><input type="number" min="0" value={data.favorites ?? ""} onChange={(event) => set("favorites", event.target.value ? Number(event.target.value) : undefined)} /></label>
                <label><span>评论</span><input type="number" min="0" value={data.comments ?? ""} onChange={(event) => set("comments", event.target.value ? Number(event.target.value) : undefined)} /></label>
              </div>
              <label className="publish-completion-field"><span>完播率 (%)</span><input type="number" min="0" max="100" value={data.completionRate ?? ""} onChange={(event) => set("completionRate", event.target.value ? Number(event.target.value) : undefined)} /></label>
              <label><span>这次的结论</span><textarea rows={3} value={data.reviewNote || ""} onChange={(event) => set("reviewNote", event.target.value)} placeholder="只记录下次会用到的判断。" /></label>
            </div>
          </details>
          <div className="publish-actions">
            <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存发布复盘"}</button>
          </div>
        </div>
      </div>

      {error && <p className="publish-error">{error}</p>}
      {notice && <p className="publish-notice">{notice}</p>}
      <CreatePreparationModal open={createOpen} onClose={() => setCreateOpen(false)} presetProjectSlug={slug} onCreated={refreshPreparations} />
    </section>
  );
}
