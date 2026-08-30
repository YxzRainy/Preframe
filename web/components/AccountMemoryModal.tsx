"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { readJsonResponse } from "../lib/readJsonResponse";

/**
 * One compact, manually maintained default for new-project generation.
 * The full shape is retained for existing local data/API compatibility.
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
  open?: boolean;
  onClose?: () => void;
  embedded?: boolean;
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

/** Merge older multi-field settings into the new single editable instruction. */
function toDefaultInstruction(memory: AccountMemory): string {
  const lines = [
    memory.creatorPersona && `定位：${memory.creatorPersona}`,
    memory.platform && `平台：${memory.platform}`,
    memory.niche && `领域：${memory.niche}`,
    memory.targetAudience && `受众：${memory.targetAudience}`,
    memory.tone && `语气：${memory.tone}`,
    memory.preferredHooks && `开头：${memory.preferredHooks}`,
    memory.contentBoundaries && `边界：${memory.contentBoundaries}`,
    memory.bannedWords && `避免：${memory.bannedWords}`,
    memory.notes,
  ].filter(Boolean);

  return lines.join("\n");
}

export function AccountMemoryModal({ open = false, onClose = () => undefined, embedded = false }: AccountMemoryModalProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadMemory() {
    const response = await fetch("/api/account-memory", { cache: "no-store" });
    const data = await readJsonResponse<{ success: boolean; memory: AccountMemory; error?: string }>(response);
    if (!response.ok || !data.success) throw new Error(data.error || "创作偏好读取失败。");
    setInstruction(toDefaultInstruction({ ...emptyMemory, ...data.memory }));
  }

  useEffect(() => {
    if (!open && !embedded) return;
    setMessage("");
    setError("");
    loadMemory().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "创作偏好读取失败。"));
  }, [embedded, open]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...emptyMemory, notes: instruction.trim() }),
      });
      const data = await readJsonResponse<{ success: boolean; memory: AccountMemory; error?: string }>(response);
      if (!response.ok || !data.success) throw new Error(data.error || "创作偏好保存失败。");
      setInstruction(toDefaultInstruction({ ...emptyMemory, ...data.memory }));
      setMessage("已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创作偏好保存失败。");
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form id="account-memory-form" className="modal-form creation-preference-form" onSubmit={save}>
      <label className="creation-preference-field">
        {!embedded && <span>默认要求</span>}
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={embedded ? 5 : 8} placeholder="例如：面向职场新人；先讲结论，表达口语化；避免“赋能、闭环”。" />
      </label>
      {!embedded && <p className="creation-preference-note">留空则不参与生成。</p>}
      {message && <p className="settings-modal-copy">{message}</p>}
      {error && <p className="settings-modal-error">{error}</p>}
      {embedded && <div className="settings-inline-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存要求"}</button></div>}
    </form>
  );

  if (embedded) return <div className="settings-embedded-form">{form}</div>;

  return (
    <Modal open={open} title="创作偏好" description="新项目生成时的默认要求" onClose={onClose} size="md" closeDisabled={busy} footer={<button type="submit" form="account-memory-form" className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存"}</button>}>
      {form}
    </Modal>
  );
}
