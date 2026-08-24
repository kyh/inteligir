import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Budgeted against the rest of the monorepo's suites, which turbo runs in
    // parallel: uncapped pools exhaust the machine and kill workers mid-run.
    maxWorkers: 2,
  },
});
