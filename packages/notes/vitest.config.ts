import { defineConfig } from "vitest/config";

// no node imports (`fileURLToPath`, aliases): tests import relative paths so the package stays pure.
export default defineConfig({
  test: {
    // this code runs inside the renderer's save path and on a phone, so a quadratic allocation
    // must fail its suite rather than pass on a workstation's multi-gigabyte default heap.
    execArgv: ["--max-old-space-size=512"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
