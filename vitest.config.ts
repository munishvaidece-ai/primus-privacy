import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors tsconfig.json's own `@/*` -> repo-root path alias (PHASE A's
  // `lib/`/`db/` imports use it) — Vitest/Vite don't read tsconfig
  // `paths` automatically, so it's declared here too rather than pulling
  // in a plugin dependency for one alias.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // See tests/shims/server-only.ts for why.
      "server-only": fileURLToPath(new URL("./tests/shims/server-only.ts", import.meta.url)),
    },
  },
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
