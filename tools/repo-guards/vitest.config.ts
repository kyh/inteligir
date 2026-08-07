import { defineConfig } from "vitest/config";

// Every test here walks the filesystem, so node is the only environment that
// makes sense.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 2,
  },
});
