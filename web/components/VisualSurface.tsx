import type { ReactNode } from "react";

type SurfaceElement = "div" | "section" | "aside";
type SurfaceDepth = "base" | "raised" | "floating" | "inset";

interface VisualSurfaceProps {
  as?: SurfaceElement;
  depth?: SurfaceDepth;
  className?: string;
  children: ReactNode;
}

/** 统一 Clean-Tech 材质与 Z 轴深度，避免业务组件散写颜色和阴影。 */
export function VisualSurface({ as = "section", depth = "raised", className = "", children }: VisualSurfaceProps) {
  const Element = as;
  return <Element className={`surface-${depth} ${className}`.trim()}>{children}</Element>;
}

export function AccentBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className="accent-badge" data-tone={tone}>{children}</span>;
}
