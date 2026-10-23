import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this repo so a parent lockfile cannot confuse
    // Turbopack (e.g. when the app runs from a git worktree).
    root: import.meta.dirname,
  },
};

export default nextConfig;
