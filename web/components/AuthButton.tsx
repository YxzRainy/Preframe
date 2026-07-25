"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "../lib/supabase/client";
import { readJsonResponse } from "../lib/readJsonResponse";

interface AuthStatus {
  authenticated: boolean;
  email: string | null;
  freeTrialUsed: number;
  freeTrialLimit: number;
  freeTrialRemaining: number;
  customModelConfigured: boolean;
  serverModelAvailable: boolean;
  canUseCustomModel: boolean;
  canUseServerTrial: boolean;
  supabaseConfigured: boolean;
  adminConfigured: boolean;
}

const fallbackStatus: AuthStatus = {
  authenticated: false,
  email: null,
  freeTrialUsed: 0,
  freeTrialLimit: 3,
  freeTrialRemaining: 0,
  customModelConfigured: false,
  serverModelAvailable: false,
  canUseCustomModel: false,
  canUseServerTrial: false,
  supabaseConfigured: false,
  adminConfigured: false,
};

async function readStatus(): Promise<AuthStatus> {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  const data = await readJsonResponse<{ success?: boolean; status?: AuthStatus; error?: string }>(response);
  if (!response.ok || !data.success || !data.status) throw new Error(data.error || "登录状态读取失败。");
  return data.status;
}

export function AuthButton() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<AuthStatus>(fallbackStatus);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const configured = isSupabaseBrowserConfigured() && Boolean(supabase);

  async function refreshStatus() {
    const next = await readStatus();
    setStatus(next);
  }

  useEffect(() => {
    refreshStatus().catch(() => undefined);
    const onUpdate = () => refreshStatus().catch(() => undefined);
    window.addEventListener("piance-auth-updated", onUpdate);
    return () => window.removeEventListener("piance-auth-updated", onUpdate);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => {
      refreshStatus()
        .then(() => window.dispatchEvent(new Event("piance-auth-updated")))
        .catch(() => undefined);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (!configured) return null;

  async function signInWithProvider(provider: "github" | "google") {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  async function signInWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setMessage(error.message);
    } else {
      setMessage("登录链接已发送，请检查邮箱。");
    }
    setBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    await supabase.auth.signOut();
    await refreshStatus().catch(() => undefined);
    window.dispatchEvent(new Event("piance-auth-updated"));
    setBusy(false);
  }

  if (status.authenticated) {
    return (
      <div className="auth-control signed-in">
        <div>
          <strong>{status.email || "已登录"}</strong>
          <small>免费体验剩余 {status.freeTrialRemaining}/{status.freeTrialLimit}</small>
        </div>
        <button type="button" onClick={signOut} disabled={busy}>{busy ? "处理中" : "退出"}</button>
      </div>
    );
  }

  return (
    <details className="auth-control auth-menu">
      <summary>{busy ? "登录中" : "登录免费体验"}</summary>
      <div className="auth-popover">
        <button type="button" onClick={() => signInWithProvider("github")} disabled={busy}>GitHub 登录</button>
        <button type="button" onClick={() => signInWithProvider("google")} disabled={busy}>Google 登录</button>
        <form onSubmit={signInWithEmail}>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          <button type="submit" disabled={busy || !email.trim()}>邮箱登录</button>
        </form>
        <small>{message || `登录后可使用 ${status.freeTrialLimit || 3} 次服务器模型生成。`}</small>
      </div>
    </details>
  );
}
