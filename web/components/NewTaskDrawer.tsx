"use client";

import type { FormEvent } from "react";
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

const CONTENT_SUBJECTS = ["个人博主", "专业人士IP", "企业品牌", "本地商家", "电商店铺", "知识账号", "生活方式账号", "机构账号", "虚拟IP"];

interface NewTaskDrawerProps {
  open: boolean;
  form: NewTaskFormData;
  loading: boolean;
  error: string;
  errorTitle?: string;
  notice?: string;
  noticeTitle?: string;
  modelConfigured: boolean;
  modelStatusLoading?: boolean;
  draftSaved: boolean;
  modelConfigurationRequired?: boolean;
  onChange: (name: keyof NewTaskFormData, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onOpenModelConfig: () => void;
  onClearDraft: () => void;
}

export function NewTaskDrawer({ open, form, loading, error, errorTitle = "生成失败", notice = "", noticeTitle = "已撤销生成", modelConfigured, modelStatusLoading = false, draftSaved, modelConfigurationRequired = false, onChange, onSubmit, onClose, onOpenModelConfig, onClearDraft }: NewTaskDrawerProps) {
  return (
    <Modal
      open={open}
      title="新建内容项目"
      description="先写下这次的想法，平台、风格和账号信息可以稍后补充。"
      onClose={onClose}
      closeDisabled={loading}
      size="lg"
      className="create-project-sheet"
      footer={<><button className="secondary-button create-project-cancel" type="button" onClick={onClose} disabled={loading}>取消</button><button className="primary-button create-project-submit" form="new-task-form" disabled={loading || modelStatusLoading || !modelConfigured} type="submit">生成策划包 <span aria-hidden="true">→</span></button></>}
    >
      <form id="new-task-form" onSubmit={onSubmit} className="modal-form new-task-form">
        <section className={`create-model-status ${modelConfigured ? "is-ready" : "is-missing"}`} aria-live="polite">
          <div><i /><span>{modelStatusLoading ? "正在检查生成服务" : modelConfigured ? "生成服务已就绪" : "需要配置生成服务"}</span></div>
          {!modelConfigured && <button className="secondary-button subtle" type="button" onClick={onOpenModelConfig}>去配置</button>}
        </section>
        <section className="create-idea-card">
          <label htmlFor="project-topic"><span>这次想做什么？ <b>*</b></span><textarea id="project-topic" autoFocus required rows={4} value={form.topic} onChange={(event) => onChange("topic", event.target.value)} placeholder="写下选题、观点、素材或一个模糊的想法…" /></label>
          <p>我们会自动拟定项目名称，并结合你的创作偏好生成第一版策划。</p>
        </section>
        <label className="create-extra-field"><span>补充要求 <em>可选</em></span><textarea rows={2} value={form.extra} onChange={(event) => onChange("extra", event.target.value)} placeholder="例如：60 秒内、不要鸡汤、少一点 AI 味" /></label>
        <details className="create-advanced-settings">
          <summary><span>调整创作设定</span><small>平台、风格与账号信息</small></summary>
          <div className="create-advanced-content">
            <div className="field-row">
              <label><span>发布平台</span><select value={form.platform} onChange={(event) => onChange("platform", event.target.value)}><option>小红书</option><option>抖音</option><option>视频号</option><option>其他</option></select></label>
              <label><span>内容风格</span><select value={form.style} onChange={(event) => onChange("style", event.target.value)}><option>专业但通俗</option><option>犀利反直觉</option><option>干货科普</option><option>情绪化种草</option><option>其他</option></select></label>
            </div>
            <label><span>内容主体 <em>可选</em></span><input list="content-subject-options" value={form.contentSubject} onChange={(event) => onChange("contentSubject", event.target.value)} placeholder="例如：健身教练 IP、餐饮品牌、AI 工具博主" /><datalist id="content-subject-options">{CONTENT_SUBJECTS.map((subject) => <option value={subject} key={subject} />)}</datalist></label>
            <div className="choice-chips" aria-label="常用内容主体">{CONTENT_SUBJECTS.map((subject) => <button className={form.contentSubject === subject ? "active" : ""} type="button" onClick={() => onChange("contentSubject", subject)} key={subject}>{subject}</button>)}</div>
            <label><span>内容领域 <em>可选</em></span><input value={form.contentDomain} onChange={(event) => onChange("contentDomain", event.target.value)} placeholder="例如：AI 工具、医美科普、健身减脂" /></label>
            <label><span>目标用户 <em>可选</em></span><input value={form.targetUser} onChange={(event) => onChange("targetUser", event.target.value)} placeholder="他们是谁，正在被什么问题困扰？" /></label>
          </div>
        </details>
        {notice && <div className="product-alert alert-success" role="status"><span>✓</span><div><strong>{noticeTitle}</strong><p>{notice}</p></div></div>}
        {error && <div className="product-alert alert-warning create-project-error" role="alert"><span>!</span><div><strong>{errorTitle}</strong><p>{error}</p>{modelConfigurationRequired && <button className="secondary-button" type="button" onClick={onOpenModelConfig}>立即配置 API</button>}</div></div>}
        <div className="create-draft-status"><span>{draftSaved ? "草稿已自动保存到本机" : "草稿将在输入后自动保存"}</span><button type="button" onClick={onClearDraft}>清空</button></div>
      </form>
    </Modal>
  );
}
