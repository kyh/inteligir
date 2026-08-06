import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-only tests for the PURE modules: the host-connection runtime
// (environment store, pairing handshake, connection owner over the iso
// @repo/bridge ws client) and the chat outbox queue model. Tests import only
// pure modules + iso @repo/bridge — never the `expo-*` / react-native wiring —
// so nothing here needs a real device or native module.
//
// Those modules resolve @repo/bridge by a relative path that climbs to the
// monorepo root, so allow fs access up there.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/host/__tests__/**/*.test.ts", "src/lib/chat/__tests__/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 1,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
