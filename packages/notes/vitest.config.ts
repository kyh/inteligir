import { defineConfig } from "vitest/config";

// Node-free config on purpose (no `fileURLToPath`/alias): tests import the
// modules under test with relative paths, so nothing here touches node APIs and
// the package stays pure.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Budgeted against the rest of the monorepo's suites, which turbo runs in
    // parallel: uncapped pools exhaust the machine and kill workers mid-run.
    maxWorkers: 2,
  },
});
