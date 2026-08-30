import { NextRequest, NextResponse } from "next/server";

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

function requestHost(request: NextRequest): URL | null {
  const host = request.headers.get("host")?.trim();
  if (!host) return null;
  try { return new URL(`http://${host}`); } catch { return null; }
}

export function proxy(request: NextRequest) {
  const hostUrl = requestHost(request);
  if (!hostUrl || !isLoopback(hostUrl.hostname)) {
    return new NextResponse("片策仅允许从本机 localhost 访问。", { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isLoopback(originUrl.hostname) || originUrl.host !== hostUrl.host) {
        return new NextResponse("拒绝跨来源访问本机项目。", { status: 403 });
      }
    } catch {
      return new NextResponse("请求来源无效。", { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
