"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";

export interface NewTaskFormData {
  projectName: string;
  topic: string;
  platform: string;
  contentSubject: string;
  contentDomain: string;
  style: string;
  targetUser: string;
  extra: string;
}

const PLATFORM_OPTIONS = ["自动判断", "小红书", "抖音", "视频号"] as const;
const STYLE_OPTIONS = [
  { label: "自动匹配", value: "自动匹配" },
  { label: "专业清晰", value: "专业但通俗" },
  { label: "直接有观点", value: "犀利反直觉" },
  { label: "轻松自然", value: "轻松自然" },
] as const;

interface NewTaskDrawerProps {
  open: boolean;
  form: NewTaskFormData;
  loading: boolean;
  error: string;
  errorTitle?: string;
  notice?: string;
  noticeTitle?: string;
  modelConfigured: boolean;
  modelStatusText?: string;
  canConfigureModel?: boolean;
  modelStatusLoading?: boolean;
  draftSaved: boolean;
  modelConfigurationRequired?: boolean;
  onChange: (name: keyof NewTaskFormData, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onOpenModelConfig: () => void;
  onClearDraft: () => void;
}

export function NewTaskDrawer({ open, form, loading, error, errorTitle = "生成失败", notice = "", noticeTitle = "已撤销生成", modelConfigured, modelStatusText, canConfigureModel = true, modelStatusLoading = false, draftSaved, modelConfigurationRequired = false, onChange, onSubmit, onClose, onOpenModelConfig, onClearDraft }: NewTaskDrawerProps) {
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreferencesOpen(Boolean(form.extra.trim()));
  }, [open]);

  const customPreferenceCount = [
    form.platform && form.platform !== "自动判断",
    form.style && form.style !== "自动匹配",
    form.extra.trim(),
  ].filter(Boolean).length;

  return (
    <Modal
      open={open}
      title="开始一个新项目"
      description="把想法说出来，片策会自动补全受众、结构和表达方式。"
      onClose={onClose}
      closeDisabled={loading}
      size="lg"
      className="create-project-sheet"
      footer={
        <>
          <span className="create-project-footer-note">{form.topic.trim() || form.extra.trim() ? (draftSaved ? "草稿已保存" : "正在保存草稿…") : "内容会自动保存"}</span>
          <button className="primary-button create-project-submit" form="new-task-form" disabled={loading || modelStatusLoading || !modelConfigured || !form.topic.trim()} type="submit">
            生成第一版 <span aria-hidden="true">→</span>
          </button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={onSubmit} className="modal-form new-task-form">
        {(!modelConfigured || modelStatusLoading) && (
          <section className={`create-model-status ${modelConfigured ? "is-ready" : "is-missing"}`} aria-live="polite">
            <div><i /><span>{modelStatusLoading ? "正在连接生成服务…" : modelStatusText || "需要配置生成服务"}</span></div>
            {!modelConfigured && canConfigureModel && <button className="secondary-button subtle" type="button" onClick={onOpenModelConfig}>去配置</button>}
          </section>
        )}

        <section className="create-prompt-composer">
          <label htmlFor="project-topic">
            <span>你想做什么？ <b>必填</b></span>
            <textarea
              id="project-topic"
              autoFocus
              required
              rows={6}
              value={form.topic}
              onChange={(event) => onChange("topic", event.target.value)}
              placeholder="写下选题、观点或素材。也可以直接说：帮我做一条 60 秒的小红书口播，讲为什么越自律的人越容易拖延…"
            />
          </label>
          <div className="create-composer-bar">
            <span>{form.topic.trim() ? `${form.topic.trim().length} 字 · 会自动拟定项目名` : "一句模糊的想法也可以"}</span>
            <button type="button" aria-expanded={preferencesOpen} onClick={() => setPreferencesOpen((current) => !current)}>
              {preferencesOpen ? "收起偏好" : customPreferenceCount ? `偏好 ${customPreferenceCount}` : "添加偏好"}
              <i aria-hidden="true" />
            </button>
          </div>
        </section>

        <div
          className={`create-preferences-reveal ${preferencesOpen ? "is-open" : ""}`}
          aria-hidden={!preferencesOpen}
          inert={!preferencesOpen}
        >
          <div className="create-preferences-reveal-inner">
            <section className="create-preferences" aria-label="生成偏好">
              <div className="create-preferences-heading">
                <div>
                  <span>生成偏好</span>
                  <p>告诉片策，你希望第一版更像什么</p>
                </div>
                <small>{customPreferenceCount ? `已调整 ${customPreferenceCount} 项` : "可随时调整"}</small>
              </div>

              <div className="create-preference-grid">
                <div className="create-preference-card">
                  <div className="create-preference-card-heading">
                    <strong>发布平台</strong>
                    <span>选择一个</span>
                  </div>
                  <p>决定标题、节奏和内容形态</p>
                  <div className="create-segmented-control" role="group" aria-label="发布平台">
                    {PLATFORM_OPTIONS.map((platform) => (
                      <button aria-pressed={form.platform === platform} className={form.platform === platform ? "active" : ""} type="button" onClick={() => onChange("platform", platform)} key={platform}>{platform === "自动判断" ? "自动" : platform}</button>
                    ))}
                  </div>
                </div>

                <div className="create-preference-card">
                  <div className="create-preference-card-heading">
                    <strong>表达方式</strong>
                    <span>选择一个</span>
                  </div>
                  <p>决定语言的气质和表达力度</p>
                  <div className="create-segmented-control" role="group" aria-label="表达方式">
                    {STYLE_OPTIONS.map((style) => (
                      <button aria-pressed={form.style === style.value} className={form.style === style.value ? "active" : ""} type="button" onClick={() => onChange("style", style.value)} key={style.value}>{style.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="create-extra-field">
                <div className="create-extra-heading">
                  <div>
                    <span>必须遵守的限制 <em>可选</em></span>
                    <small>写下时长、语气、禁用词等硬性要求</small>
                  </div>
                  <small>{form.extra.trim() ? `${form.extra.trim().length} 字` : "不填写也可以"}</small>
                </div>
                <textarea rows={2} value={form.extra} onChange={(event) => onChange("extra", event.target.value)} placeholder="例如：60 秒内，不要鸡汤，避免专业术语" />
              </label>
              <div className="create-preferences-foot">
                <span>主体、领域和受众会从想法与账号记忆中推断。</span>
                <button type="button" onClick={onClearDraft}>清空内容</button>
              </div>
            </section>
          </div>
        </div>
        {notice && <div className="product-alert alert-success" role="status"><span>✓</span><div><strong>{noticeTitle}</strong><p>{notice}</p></div></div>}
        {error && <div className="product-alert alert-warning create-project-error" role="alert"><span>!</span><div><strong>{errorTitle}</strong><p>{error}</p>{modelConfigurationRequired && <button className="secondary-button" type="button" onClick={onOpenModelConfig}>立即配置 API</button>}</div></div>}
      </form>
    </Modal>
  );
}
