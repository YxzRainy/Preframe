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
  modelStatusLabel: string;
  modelStatusLoading?: boolean;
  draftSaved: boolean;
  modelConfigurationRequired?: boolean;
  onChange: (name: keyof NewTaskFormData, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onOpenModelConfig: () => void;
  onClearDraft: () => void;
}

export function NewTaskDrawer({ open, form, loading, error, errorTitle = "生成失败", notice = "", noticeTitle = "已撤销生成", modelConfigured, modelStatusLabel, modelStatusLoading = false, draftSaved, modelConfigurationRequired = false, onChange, onSubmit, onClose, onOpenModelConfig, onClearDraft }: NewTaskDrawerProps) {
  return (
    <Modal
      open={open}
      title="创建内容项目"
      description="提交后将生成 10 份前期策划包文档。"
      onClose={onClose}
      closeDisabled={loading}
      size="lg"
      footer={<><button className="secondary-button" type="button" onClick={onClose} disabled={loading}>取消</button><button className="primary-button" form="new-task-form" disabled={loading || modelStatusLoading || !modelConfigured} type="submit">创建内容项目</button></>}
    >
      <form id="new-task-form" onSubmit={onSubmit} className="modal-form new-task-form">
        <section className={`create-model-status ${modelConfigured ? "is-ready" : "is-missing"}`} aria-live="polite">
          <div><i /><span>{modelStatusLoading ? "正在读取模型配置" : modelStatusLabel}</span></div>
          <button className="secondary-button subtle" type="button" onClick={onOpenModelConfig}>配置模型</button>
        </section>
        <label><span>项目名称 <b>*</b></span><input autoFocus required value={form.projectName} onChange={(event) => onChange("projectName", event.target.value)} placeholder="例如：AI判断力短视频策划" /></label>
        <label><span>选题主题 <b>*</b></span><textarea required rows={3} value={form.topic} onChange={(event) => onChange("topic", event.target.value)} placeholder="例如：AI降低的是执行门槛，提高的是判断门槛" /></label>
        <label><span>内容主体 <b>*</b></span><input required list="content-subject-options" value={form.contentSubject} onChange={(event) => onChange("contentSubject", event.target.value)} placeholder="例如：健身教练IP / 本地餐饮品牌 / AI工具博主 / 医美医生 / 求职作品集账号" /><datalist id="content-subject-options">{CONTENT_SUBJECTS.map((subject) => <option value={subject} key={subject} />)}</datalist></label>
        <div className="choice-chips" aria-label="常用内容主体">{CONTENT_SUBJECTS.map((subject) => <button className={form.contentSubject === subject ? "active" : ""} type="button" onClick={() => onChange("contentSubject", subject)} key={subject}>{subject}</button>)}<button className={!CONTENT_SUBJECTS.includes(form.contentSubject) ? "active" : ""} type="button" onClick={() => onChange("contentSubject", "")}>自定义</button></div>
        <label><span>内容领域 <b>*</b></span><input required value={form.contentDomain} onChange={(event) => onChange("contentDomain", event.target.value)} placeholder="例如：AI工具 / 医美科普 / 健身减脂 / 本地生活 / 职场成长 / 数码测评" /></label>
        <div className="field-row">
          <label><span>发布平台</span><select value={form.platform} onChange={(event) => onChange("platform", event.target.value)}><option>小红书</option><option>抖音</option><option>视频号</option><option>其他</option></select></label>
          <label><span>内容风格</span><select value={form.style} onChange={(event) => onChange("style", event.target.value)}><option>专业但通俗</option><option>犀利反直觉</option><option>干货科普</option><option>情绪化种草</option><option>其他</option></select></label>
        </div>
        <label><span>目标用户 <b>*</b></span><input required value={form.targetUser} onChange={(event) => onChange("targetUser", event.target.value)} placeholder="他们是谁，正在被什么问题困扰？" /></label>
        <label><span>补充要求</span><textarea rows={3} value={form.extra} onChange={(event) => onChange("extra", event.target.value)} placeholder="例如：60秒内，不要鸡汤，减少AI味" /></label>
        {notice && <div className="product-alert alert-success" role="status"><span>✓</span><div><strong>{noticeTitle}</strong><p>{notice}</p></div></div>}
        {error && <div className="product-alert alert-warning create-project-error" role="alert"><span>!</span><div><strong>{errorTitle}</strong><p>{error}</p>{modelConfigurationRequired && <button className="secondary-button" type="button" onClick={onOpenModelConfig}>立即配置 API</button>}</div></div>}
        <div className="create-draft-status"><span>{draftSaved ? "草稿已自动保存" : "草稿将在输入后自动保存"}</span><button type="button" onClick={onClearDraft}>清空草稿</button></div>
      </form>
    </Modal>
  );
}
