import { defineConfig } from "vitest/config";

// Every test here walks the filesystem, so node is the only environment that
// makes sense.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 2,
    // These walk the whole tree, and the docs-link guard runs a markdown parse
    // per file — comfortably past vitest's 5s default once the other suites
    // are competing for the machine.
    testTimeout: 60_000,
  },
});
