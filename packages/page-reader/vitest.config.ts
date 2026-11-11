import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          exclude: ["src/**/*.heap.test.ts"],
          include: ["src/**/*.test.ts"],
          name: "reader",
        },
      },
      {
        extends: true,
        // a Worker isolate holds 128 MB in all: the old generation capped under it, the young one
        // small, so the test runner's own modules leave the reading less room than a Worker would
        test: {
          execArgv: ["--max-old-space-size=96", "--max-semi-space-size=8"],
          include: ["src/**/*.heap.test.ts"],
          name: "heap",
        },
      },
    ],
  },
});
