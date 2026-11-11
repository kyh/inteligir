import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // the library's model runs inside the page's save path and on a phone, so a quadratic
    // allocation must fail its suite rather than pass on a workstation's multi-gigabyte default heap.
    execArgv: ["--max-old-space-size=512"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
