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
        // the reading's budget (src/extract-page.heap.test.ts): the old generation capped at it and
        // the young one small, so a reading that outgrows it takes the process down
        test: {
          execArgv: ["--max-old-space-size=96", "--max-semi-space-size=8"],
          include: ["src/**/*.heap.test.ts"],
          name: "heap",
        },
      },
    ],
  },
});
