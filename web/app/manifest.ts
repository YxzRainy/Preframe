import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "片策｜短视频前期策划工作台",
    short_name: "片策",
    description: "输入一个选题，创建短视频内容项目并生成前期策划包，包括 10 份可修改的 Markdown 文档。",
    start_url: "/",
    display: "standalone",
    background_color: "#070a0f",
    theme_color: "#0d111a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
