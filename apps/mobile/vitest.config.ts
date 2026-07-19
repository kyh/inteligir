import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-only tests for the PURE modules: the sync adapters (path/recursion,
// base-store JSON, clock format) plus an end-to-end SyncEngine pass, and the
// host-connection runtime (environment store, pairing handshake, connection
// owner over the iso @repo/bridge ws client). Tests import only pure
// modules + @repo/domain + iso @repo/bridge — never the `expo-*` /
// react-native wiring — so nothing here needs a real device or native module.
//
// The engine test reaches @repo/domain's coordinator fake by a relative path that
// climbs to the monorepo root, so allow fs access up there.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/sync/__tests__/**/*.test.ts", "src/lib/host/__tests__/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 1,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
