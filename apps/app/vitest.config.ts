import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node by default (the server suites); the UI component tests opt into
    // jsdom per file via an @vitest-environment docblock.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/app/__tests__/jsdom-stubs.ts"],
    // Budgeted against the rest of the monorepo's suites, which turbo runs in
    // parallel: uncapped pools exhaust the machine and kill workers mid-run.
    maxWorkers: 2,
  },
});
