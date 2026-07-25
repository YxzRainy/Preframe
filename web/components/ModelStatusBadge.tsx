"use client";

import { useEffect, useState } from "react";
import { readJsonResponse } from "../lib/readJsonResponse";

interface TrialStatus {
  authenticated: boolean;
  freeTrialRemaining: number;
  freeTrialLimit: number;
  customModelConfigured: boolean;
  serverModelAvailable: boolean;
  supabaseConfigured: boolean;
  adminConfigured: boolean;
}

interface StatusView {
  tone: "success" | "warning" | "error" | "muted";
  label: string;
}

function viewFromStatus(status: TrialStatus | null): StatusView {
  if (!status) return { tone: "muted", label: "模型状态读取中" };
  if (status.customModelConfigured) return { tone: "success", label: "自定义模型已配置" };
  if (!status.serverModelAvailable || !status.supabaseConfigured || !status.adminConfigured) return { tone: "error", label: "服务器模型不可用" };
  if (!status.authenticated) return { tone: "muted", label: "未登录" };
  if (status.freeTrialRemaining > 0) return { tone: "success", label: `免费体验可用 · ${status.freeTrialRemaining}/${status.freeTrialLimit}` };
  return { tone: "warning", label: "免费体验已用完" };
}

export function ModelStatusBadge() {
  const [status, setStatus] = useState<TrialStatus | null>(null);

  async function refresh() {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    const data = await readJsonResponse<{ status?: TrialStatus }>(response);
    if (response.ok && data.status) setStatus(data.status);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
    const onUpdate = () => refresh().catch(() => undefined);
    window.addEventListener("piance-auth-updated", onUpdate);
    window.addEventListener("piance-model-config-updated", onUpdate);
    return () => {
      window.removeEventListener("piance-auth-updated", onUpdate);
      window.removeEventListener("piance-model-config-updated", onUpdate);
    };
  }, []);

  const view = viewFromStatus(status);
  return <span className={`model-status-badge model-status-${view.tone}`}><i />{view.label}</span>;
}
