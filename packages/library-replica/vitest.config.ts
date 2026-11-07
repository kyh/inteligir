import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // the engine runs on a phone: a quadratic allocation must fail its suite here rather than
    // pass on a workstation's multi-gigabyte default heap
    execArgv: ["--max-old-space-size=512"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
