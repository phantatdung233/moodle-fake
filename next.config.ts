import type { NextConfig } from "next";
import { MAX_UPLOAD_LIMIT } from "./src/lib/admin/upload-limits";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this repo so a parent lockfile cannot confuse
    // Turbopack (e.g. when the app runs from a git worktree).
    root: import.meta.dirname,
  },
  experimental: {
    serverActions: {
      // Default is 1 MB, which rejects the ~1.2 MB Moodle export before the
      // upload action runs — the giảng viên would see a dev error, not the
      // Vietnamese size message. Keep it in step with MAX_UPLOAD_BYTES.
      bodySizeLimit: MAX_UPLOAD_LIMIT,
    },
  },
};

export default nextConfig;
