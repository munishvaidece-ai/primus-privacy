import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // RLS tests hit a real Postgres connection per case — keep them
    // sequential within a file (default) and avoid excess parallel
    // connection pressure across files.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
