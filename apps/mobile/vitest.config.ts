import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-only tests for the PURE sync adapters (path/recursion, base-store JSON,
// clock format) plus an end-to-end SyncEngine pass. Tests import only the pure
// adapter modules + @repo/core — never the `expo-*` wiring — so nothing here
// needs a real device or expo native module.
//
// The engine test reaches @repo/core's coordinator fake by a relative path that
// climbs to the monorepo root, so allow fs access up there.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/sync/__tests__/**/*.test.ts"],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
