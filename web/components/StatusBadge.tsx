import type { ReactNode } from "react";

export function StatusBadge({ children, tone = "ready" }: { children: ReactNode; tone?: "ready" | "working" | "muted" | "warning" }) {
  return <span className={`status-badge status-${tone}`}><i aria-hidden="true" />{children}</span>;
}
