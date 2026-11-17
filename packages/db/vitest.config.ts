import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test-database.ts"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    setupFiles: ["./src/test-database-file.ts"],
  },
});
