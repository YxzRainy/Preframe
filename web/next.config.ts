import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingRoot: process.cwd(),
  onDemandEntries: {
    maxInactiveAge: 10 * 60 * 1000,
    pagesBufferLength: 10,
  },
  experimental: {
    externalDir: true,
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
