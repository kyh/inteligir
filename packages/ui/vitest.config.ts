import { defineConfig } from "vitest/config";

// No self-name alias on purpose: sources/tests import each other with
// relative paths; cross-package imports resolve through workspace exports.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Budgeted against the rest of the monorepo's suites, which turbo runs in
    // parallel: uncapped pools exhaust the machine and kill workers mid-run.
    maxWorkers: 2,
  },
});
