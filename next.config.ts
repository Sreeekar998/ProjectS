import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the interactive dev server, production builds, and Playwright's
  // second dev server out of one another's compiler caches. Sharing `.next`
  // between concurrent Next processes can leave the live app serving a stale
  // or partially replaced bundle after a build/test run.
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  serverExternalPackages: ["better-sqlite3", "playwright"],
  eslint: { ignoreDuringBuilds: false },
  // A lockfile in a parent directory (this app lives inside the broader Sun
  // Project folder) makes Next.js guess the workspace root incorrectly;
  // pin it explicitly rather than tracing from process.cwd() upward.
  outputFileTracingRoot: process.cwd(),
  // The local SQLite DB (WAL files) and the evidence store both live inside
  // this project directory and are written constantly at runtime (every
  // crawled page, every observation). Without this, Next's dev file
  // watcher treats every write as a source change and triggers a full
  // recompile/reload loop, which tears down the SSE connection mid-crawl.
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/data/**", "**/evidence-store/**", "**/node_modules/**", "**/.git/**"],
    };
    return config;
  },
};

export default nextConfig;
