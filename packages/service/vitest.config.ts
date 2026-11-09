import { defineConfig } from "vitest/config";

// no node imports (`fileURLToPath`, aliases): tests import relative paths, as the cell's code does.
export default defineConfig({
  test: {
    // this code runs in the account's cell, whose isolate holds 128 MB, so a quadratic allocation
    // must fail its suite rather than pass on a workstation's multi-gigabyte default heap.
    execArgv: ["--max-old-space-size=512"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
