import { defineConfig } from "vitest/config";

// Node-free config on purpose (no `fileURLToPath`/alias): tests import the
// modules under test with relative paths, so nothing here touches node APIs and
// the package stays isomorphic.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 2,
  },
});
