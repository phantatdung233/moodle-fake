import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // `.tsx` tests render React; the app's `tsconfig` keeps JSX for Next, so the
  // test transform needs a plugin that emits it.
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup-env.ts"],
    // MongodbMemoryServer may download its mongod binary on the first run.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
