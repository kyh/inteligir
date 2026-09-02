import { configDefaults, defineConfig } from "vitest/config";

// Suites that BOOT the server graph inside a DOM test carry the `.booted.`
// marker, so a new one lands in the right project by name alone.
const BOOTED_DOM_SUITES = "src/**/*.booted.test.tsx";

const SETUP_FILES = ["src/renderer/app/__tests__/jsdom-stubs.ts"];

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: {
          name: "desktop",
          // The renderer's component tests opt into jsdom per file via an
          // @vitest-environment docblock; the main-process policy suites run
          // on the node default.
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [...configDefaults.exclude, BOOTED_DOM_SUITES],
          setupFiles: SETUP_FILES,
        },
      },
      {
        test: {
          name: "desktop-booted-dom",
          // jsdom's globals over the ssr transform; the file states why the
          // builtin jsdom environment cannot boot the server graph.
          environment: "./src/renderer/app/__tests__/jsdom-ssr-environment.ts",
          include: [BOOTED_DOM_SUITES],
          setupFiles: SETUP_FILES,
        },
      },
    ],
  },
});
