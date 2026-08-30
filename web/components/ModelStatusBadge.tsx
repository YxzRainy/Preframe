"use client";

import { useEffect, useState } from "react";
import { readJsonResponse } from "../lib/readJsonResponse";

interface StatusView {
  tone: "success" | "warning" | "error" | "muted";
  label: string;
}

interface ModelStatusBadgeProps {
  compact?: boolean;
}

const statusLabels: Record<StatusView["tone"], string> = {
  success: "AI 能力已启用",
  warning: "AI 能力尚未启用",
  error: "AI 能力异常",
  muted: "AI 能力检查中",
};

export function ModelStatusBadge({ compact = false }: ModelStatusBadgeProps) {
  const [view, setView] = useState<StatusView>({ tone: "muted", label: statusLabels.muted });
  const [refreshing, setRefreshing] = useState(false);

  async function loadConfiguration() {
    const response = await fetch("/api/model-config", { cache: "no-store" });
    const data = await readJsonResponse<{ config?: { configured?: boolean } }>(response);
    setView(response.ok && data.config?.configured
      ? { tone: "success", label: statusLabels.success }
      : { tone: "warning", label: statusLabels.warning });
  }

  async function refreshConnection() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/model-config/test", { method: "POST", cache: "no-store" });
      setView(response.ok
        ? { tone: "success", label: statusLabels.success }
        : { tone: "error", label: statusLabels.error });
    } catch {
      setView({ tone: "error", label: statusLabels.error });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadConfiguration().catch(() => setView({ tone: "error", label: statusLabels.error }));
    const onUpdate = () => loadConfiguration().catch(() => setView({ tone: "error", label: statusLabels.error }));
    window.addEventListener("piance-model-config-updated", onUpdate);
    return () => window.removeEventListener("piance-model-config-updated", onUpdate);
  }, []);

  const label = refreshing ? statusLabels.muted : compact ? statusLabels[view.tone] : view.label;

  return (
    <button
      type="button"
      className={`model-status-badge model-status-${view.tone}`}
      aria-label="刷新模型连接状态"
      aria-live="polite"
      disabled={refreshing}
      title="点击刷新模型连接状态"
      onClick={() => void refreshConnection()}
    >
      <i aria-hidden="true" />
      {label}
    </button>
  );
}
