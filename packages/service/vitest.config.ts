import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["@repo/db/test-database"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    setupFiles: ["@repo/db/test-database-file"],
  },
});
