import { defineConfig } from "vitest/config";

// No self-name alias on purpose: backend sources/tests import each other with
// relative paths; cross-package imports resolve through workspace exports.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 2,
  },
});
