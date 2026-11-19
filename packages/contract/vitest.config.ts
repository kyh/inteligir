import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    execArgv: ["--max-old-space-size=512"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
