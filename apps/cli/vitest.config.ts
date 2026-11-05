import { configDefaults, defineConfig } from "vitest/config";

// the suites that run the editor's browser-side serializer over this server's seed and its
// placement (src/workspace/), which compile under the DOM's lib
const EDITOR_SUITES = "src/workspace/**/*.test.ts";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: {
          exclude: [...configDefaults.exclude, EDITOR_SUITES],
          include: ["src/**/*.test.ts"],
          name: "cli",
        },
      },
      {
        test: {
          include: [EDITOR_SUITES],
          name: "editor",
        },
      },
    ],
  },
});
