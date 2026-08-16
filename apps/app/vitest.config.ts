import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node by default (the server suites); the UI component tests opt into
    // jsdom per file via an @vitest-environment docblock.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/app/__tests__/jsdom-stubs.ts"],
    // Monorepo worker budget (see packages/notes/vitest.config.ts).
    maxWorkers: 2,
  },
});
