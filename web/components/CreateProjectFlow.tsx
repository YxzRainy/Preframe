"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GenerateWorkspace } from "./GenerateWorkspace";

export function CreateProjectFlow() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const request = useMemo(() => {
    if (pathname !== "/" || searchParams.get("new") !== "1") return null;
    return {
      id: searchParams.toString(),
      ideaId: searchParams.get("ideaId") || undefined,
      projectName: searchParams.get("projectName") || undefined,
      topic: searchParams.get("topic") || undefined,
      extra: searchParams.get("extra") || undefined,
    };
  }, [pathname, searchParams]);

  const clearRequest = useCallback(() => {
    router.replace("/", { scroll: false });
  }, [router]);

  return <GenerateWorkspace presentation="modal" openRequest={request} onOpenRequestHandled={clearRequest} />;
}
