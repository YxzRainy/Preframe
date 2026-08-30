"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { readJsonResponse } from "../lib/readJsonResponse";

interface CreatorProfile {
  name: string;
  avatarUrl: string;
}

interface CreatorProfileModalProps {
  open?: boolean;
  onClose?: () => void;
  onSaved?: () => void;
  embedded?: boolean;
}

export function CreatorProfileModal({ open = false, onClose = () => undefined, onSaved, embedded = false }: CreatorProfileModalProps) {
  const [profile, setProfile] = useState<CreatorProfile>({ name: "创作者", avatarUrl: "/api/profile/avatar" });
  const [nameInput, setNameInput] = useState("创作者");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [avatarVersion, setAvatarVersion] = useState(0);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open && !embedded) return;
    async function loadProfile() {
      try {
        const response = await fetch("/api/profile");
        const data = await readJsonResponse<{ profile: CreatorProfile; error?: string }>(response);
        if (!response.ok) throw new Error(data.error || "创作者资料读取失败。");
        const next = data.profile as CreatorProfile;
        setProfile(next);
        setNameInput(next.name);
        setAvatarFailed(false);
        setAvatarVersion(Date.now());
      } catch (err) {
        // fail silently on load
      }
    }
    loadProfile();
  }, [embedded, open]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview("");
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const form = new FormData();
      form.set("name", nameInput);
      if (avatarFile) form.set("avatar", avatarFile);
      const response = await fetch("/api/profile", { method: "POST", body: form });
      const data = await readJsonResponse<{ profile: CreatorProfile; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "创作者资料保存失败。");
      const next = data.profile as CreatorProfile;
      setProfile(next);
      setNameInput(next.name);
      setAvatarFile(null);
      setAvatarFailed(false);
      setAvatarVersion(Date.now());
      onSaved?.();
      if (!embedded) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创作者资料保存失败。");
    } finally {
      setSaving(false);
    }
  }

  function chooseAvatar(file?: File) {
    setError("");
    if (!file) {
      setAvatarFile(null);
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      setError("头像仅支持 PNG、JPG、JPEG、WEBP。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("头像文件不能超过 10MB。");
      return;
    }
    setAvatarFile(file);
    setAvatarFailed(false);
  }

  async function resetProfile() {
    setSaving(true); setError("");
    try {
      const form = new FormData();
      form.set("reset", "true");
      const response = await fetch("/api/profile", { method: "POST", body: form });
      const data = await readJsonResponse<{ profile: CreatorProfile; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "创作者资料恢复失败。");
      const next = data.profile as CreatorProfile;
      setProfile(next);
      setNameInput(next.name);
      setAvatarFile(null);
      setAvatarFailed(true);
      setAvatarVersion(Date.now());
      onSaved?.();
      if (!embedded) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创作者资料恢复失败。");
    } finally {
      setSaving(false);
    }
  }

  const avatarSrc = avatarPreview || (avatarVersion ? `${profile.avatarUrl}?v=${avatarVersion}` : profile.avatarUrl);
  const showAvatarImage = Boolean(avatarPreview || !avatarFailed);

  const form = (
    <form id="profile-form" className="modal-form" onSubmit={saveProfile}>
      <div className="profile-avatar-editor">
        <span className="profile-avatar-preview">{showAvatarImage ? <img src={avatarSrc} alt={`${profile.name}的头像预览`} onError={() => setAvatarFailed(true)} /> : <i />}</span>
        <div className="avatar-upload-copy">
          {!embedded && <span>头像</span>}
          <input ref={avatarInputRef} className="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
          <button className="avatar-upload-control" type="button" onClick={() => avatarInputRef.current?.click()}>{embedded ? "更换" : "更换头像"}</button>
          <small>{avatarFile ? avatarFile.name : embedded ? "PNG、JPG 或 WEBP" : "PNG / JPG / WEBP，最大 10MB。"}</small>
        </div>
      </div>
      <label className="settings-profile-name">{!embedded && <span>昵称</span>}<input aria-label="昵称" required value={nameInput} onChange={(event) => setNameInput(event.target.value)} placeholder="创作者昵称" /></label>
      {error && <p className="settings-modal-error">{error}</p>}
      {embedded && <div className="settings-inline-actions"><button type="button" className="secondary-button" onClick={resetProfile} disabled={saving}>恢复默认</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中" : "保存资料"}</button></div>}
    </form>
  );

  if (embedded) return <div className="settings-embedded-form">{form}</div>;

  return (
    <Modal open={open} title="创作者资料" description="昵称和头像只保存在本机，不会上传到云端。" onClose={onClose} closeDisabled={saving} footer={<><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>取消</button><button type="button" className="secondary-button" onClick={resetProfile} disabled={saving}>恢复默认</button><button type="submit" form="profile-form" className="primary-button" disabled={saving}>{saving ? "保存中" : "保存"}</button></>}>
      {form}
    </Modal>
  );
}
