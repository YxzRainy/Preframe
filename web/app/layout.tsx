import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { TopBar } from "../components/TopBar";
import { AppSidebar } from "../components/AppSidebar";
import { CreateProjectFlow } from "../components/CreateProjectFlow";
import { getCreatorProfile } from "../../src/services/profileConfig";
import { getWorkspaceStats } from "../../src/services/workspaceConfig";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "片策｜短视频前期策划工作台",
  applicationName: "片策",
  description: "输入一个选题，创建短视频内容项目并生成前期策划包，包括项目概览、选题拆解、口播脚本、分镜与剪辑节奏、拍摄清单、封面标题与发布文案、视觉参考提示词和内容质检报告。",
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
    title: "片策｜短视频前期策划工作台",
    description: "输入一个选题，创建短视频内容项目并生成前期策划包，包括项目概览、选题拆解、口播脚本、分镜与剪辑节奏、拍摄清单、封面标题与发布文案、视觉参考提示词和内容质检报告。",
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
        <div className="app-main-shell">{children}</div>
        <Suspense fallback={null}><CreateProjectFlow /></Suspense>
      </body>
    </html>
  );
}
