"use client";

import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { readJsonResponse } from "../lib/readJsonResponse";

/**
 * 创作偏好（原"账号记忆"）。
 * 数据层仍保留完整 AccountMemory 字段以兼容已积累的数据与诊断管线；
 * UI 第一版只暴露 3 个轻量字段，高级字段折叠隐藏，避免大表单压迫感。
 */
interface AccountMemory {
  accountName: string;
  platform: string;
  niche: string;
  targetAudience: string;
  tone: string;
  bannedWords: string;
  preferredHooks: string;
  shootingDevice: string;
  shootingScenes: string;
  creatorPersona: string;
  contentBoundaries: string;
  successfulTopics: string;
  failedTopics: string;
  notes: string;
}

interface AccountMemoryModalProps {
  open: boolean;
  onClose: () => void;
}

const emptyMemory: AccountMemory = {
  accountName: "",
  platform: "",
  niche: "",
  targetAudience: "",
  tone: "",
  bannedWords: "",
  preferredHooks: "",
  shootingDevice: "",
  shootingScenes: "",
  creatorPersona: "",
  contentBoundaries: "",
  successfulTopics: "",
  failedTopics: "",
  notes: "",
};

/** 高级字段（折叠区，默认关闭） */
const advancedFields: Array<{ key: keyof AccountMemory; label: string; placeholder?: string; area?: boolean }> = [
  { key: "platform", label: "主要平台" },
  { key: "niche", label: "内容领域" },
  { key: "targetAudience", label: "目标用户" },
  { key: "tone", label: "常用语气" },
  { key: "preferredHooks", label: "常用开头风格", area: true },
  { key: "contentBoundaries", label: "内容边界", area: true },
  { key: "successfulTopics", label: "成功选题", area: true },
  { key: "failedTopics", label: "失败选题", area: true },
  { key: "shootingDevice", label: "拍摄设备" },
  { key: "shootingScenes", label: "常用拍摄场景", area: true },
  { key: "notes", label: "补充说明", area: true },
];

export function AccountMemoryModal({ open, onClose }: AccountMemoryModalProps) {
  const [form, setForm] = useState<AccountMemory>(emptyMemory);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function loadMemory() {
    const response = await fetch("/api/account-memory", { cache: "no-store" });
    const data = await readJsonResponse<{ success: boolean; memory: AccountMemory; error?: string }>(response);
    if (!response.ok || !data.success) throw new Error(data.error || "创作偏好读取失败。");
    setForm({ ...emptyMemory, ...data.memory });
  }

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError("");
    setAdvancedOpen(false);
    loadMemory().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "创作偏好读取失败。"));
  }, [open]);

  function update(key: keyof AccountMemory, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readJsonResponse<{ success: boolean; memory: AccountMemory; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "创作偏好保存失败。");
      setForm({ ...emptyMemory, ...data.memory });
      setMessage("创作偏好已保存到本机。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创作偏好保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function clearMemory() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emptyMemory),
      });
      const data = await readJsonResponse<{ success: boolean; memory: AccountMemory; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "创作偏好清空失败。");
      setForm({ ...emptyMemory });
      setMessage("创作偏好已清空。");
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "创作偏好清空失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="创作偏好"
      description="账号内容方向的轻量画像"
      onClose={onClose}
      size="md"
      closeDisabled={busy}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={clearMemory} disabled={busy}>清空</button>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" form="account-memory-form" className="primary-button" disabled={busy}>{busy ? "保存中" : "保存"}</button>
        </>
      )}
    >
      <form id="account-memory-form" className="modal-form creation-preference-form" onSubmit={save}>
        <p className="creation-preference-hint">
          创作偏好会根据你后续采用、修改和发布的内容逐步积累，无需一次填写完整资料。
        </p>

        <label>
          <span>账号名称</span>
          <input value={form.accountName} onChange={(event) => update("accountName", event.target.value)} placeholder="如 抖音主号" />
        </label>
        <label>
          <span>一句话定位</span>
          <input value={form.creatorPersona} onChange={(event) => update("creatorPersona", event.target.value)} placeholder="如 用 30 秒讲清一个产品决策" />
        </label>
        <label>
          <span>不希望出现的表达（可选）</span>
          <textarea value={form.bannedWords} onChange={(event) => update("bannedWords", event.target.value)} placeholder="一行一个或用逗号分隔" rows={3} />
        </label>

        <button
          type="button"
          className="publish-link-btn creation-preference-advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "收起高级设置" : "高级设置（可选）"}
        </button>

        {advancedOpen && (
          <div className="creation-preference-advanced">
            {advancedFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.area ? (
                  <textarea value={form[field.key]} onChange={(event) => update(field.key, event.target.value)} rows={3} />
                ) : (
                  <input value={form[field.key]} onChange={(event) => update(field.key, event.target.value)} />
                )}
              </label>
            ))}
          </div>
        )}

        {message && <p className="settings-modal-copy">{message}</p>}
        {error && <p className="settings-modal-error">{error}</p>}
      </form>
    </Modal>
  );
}
