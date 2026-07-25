"use client";

import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { readJsonResponse } from "../lib/readJsonResponse";

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

const textareaFields: Array<{ key: keyof AccountMemory; label: string; placeholder?: string }> = [
  { key: "bannedWords", label: "禁用词", placeholder: "一行一个或用逗号分隔" },
  { key: "preferredHooks", label: "常用开头风格" },
  { key: "contentBoundaries", label: "内容边界" },
  { key: "successfulTopics", label: "成功选题" },
  { key: "failedTopics", label: "失败选题" },
  { key: "shootingDevice", label: "拍摄设备" },
  { key: "shootingScenes", label: "拍摄场景" },
  { key: "notes", label: "补充说明" },
];

export function AccountMemoryModal({ open, onClose }: AccountMemoryModalProps) {
  const [form, setForm] = useState<AccountMemory>(emptyMemory);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadMemory() {
    const response = await fetch("/api/account-memory", { cache: "no-store" });
    const data = await readJsonResponse<{ success: boolean; memory: AccountMemory; error?: string }>(response);
    if (!response.ok || !data.success) throw new Error(data.error || "账号记忆读取失败。");
    setForm({ ...emptyMemory, ...data.memory });
  }

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError("");
    loadMemory().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "账号记忆读取失败。"));
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
      if (!response.ok || !data.success) throw new Error(data.error || "账号记忆保存失败。");
      setForm({ ...emptyMemory, ...data.memory });
      setMessage("账号记忆已保存到本机。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "账号记忆保存失败。");
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
      if (!response.ok || !data.success) throw new Error(data.error || "账号记忆清空失败。");
      setForm({ ...emptyMemory });
      setMessage("账号记忆已清空。");
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "账号记忆清空失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="账号记忆"
      description="本地创作者账号画像"
      onClose={onClose}
      size="lg"
      closeDisabled={busy}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={clearMemory} disabled={busy}>清空</button>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" form="account-memory-form" className="primary-button" disabled={busy}>{busy ? "保存中" : "保存记忆"}</button>
        </>
      )}
    >
      <form id="account-memory-form" className="modal-form account-memory-form" onSubmit={save}>
        <div className="account-memory-grid">
          <label><span>账号名</span><input value={form.accountName} onChange={(event) => update("accountName", event.target.value)} /></label>
          <label><span>平台</span><input value={form.platform} onChange={(event) => update("platform", event.target.value)} /></label>
          <label><span>内容领域</span><input value={form.niche} onChange={(event) => update("niche", event.target.value)} /></label>
          <label><span>目标用户</span><input value={form.targetAudience} onChange={(event) => update("targetAudience", event.target.value)} /></label>
          <label><span>语气</span><input value={form.tone} onChange={(event) => update("tone", event.target.value)} /></label>
          <label><span>人设定位</span><input value={form.creatorPersona} onChange={(event) => update("creatorPersona", event.target.value)} /></label>
        </div>

        {textareaFields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <textarea value={form[field.key]} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} rows={3} />
          </label>
        ))}
        {message && <p className="settings-modal-copy">{message}</p>}
        {error && <p className="settings-modal-error">{error}</p>}
      </form>
    </Modal>
  );
}
