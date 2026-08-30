import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { TopBar } from "../components/TopBar";
import { AppSidebar } from "../components/AppSidebar";
import { CreateProjectFlow } from "../components/CreateProjectFlow";
import { RouteTransition } from "../components/RouteTransition";
import { CommandPalette } from "../components/CommandPalette";
import { getCreatorProfile } from "../../src/services/profileConfig";
import { getWorkspaceStats } from "../../src/services/workspaceConfig";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "片策｜工作台",
    template: "片策｜%s",
  },
  applicationName: "片策",
  description: "输入一个选题，生成三份一致的核心工作稿：创作简报、可直接拍摄的执行稿，以及发布与真实数据复盘。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "片策",
    title: "片策｜工作台",
    description: "输入一个选题，生成三份一致的核心工作稿：创作简报、可直接拍摄的执行稿，以及发布与真实数据复盘。",
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [profile, workspace] = await Promise.all([
    getCreatorProfile().catch(() => ({ name: "创作者" })),
    getWorkspaceStats().catch(() => ({
      outputDir: "output/",
      outputDirAbsolute: "",
      projectCount: 0,
      totalSizeBytes: 0,
      totalSizeLabel: "0 KB",
      currentProjectName: "未创建",
    })),
  ]);

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var savedTheme = localStorage.getItem('preframe:theme');
                  var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
                  if (savedTheme === 'light' || (!savedTheme && prefersLight)) {
                    document.documentElement.setAttribute('data-theme', 'light');
                  } else {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <AppSidebar initialWorkspace={workspace} />
        <TopBar initialProfile={{ name: profile.name, avatarUrl: "/api/profile/avatar" }} />
        <div className="app-main-shell"><RouteTransition>{children}</RouteTransition></div>
        <CommandPalette />
        <Suspense fallback={null}><CreateProjectFlow /></Suspense>
      </body>
    </html>
  );
}
