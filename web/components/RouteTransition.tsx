"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

interface RouteTransitionProps {
  children: ReactNode;
}

/** Re-mounts the page surface on pathname changes so the enter animation plays
 * without disturbing the persistent sidebar and top bar. Query-only changes,
 * such as switching a settings tab, intentionally keep the same surface. */
export function RouteTransition({ children }: RouteTransitionProps) {
  const pathname = usePathname();
  return <div className="route-transition" key={pathname}>{children}</div>;
}
