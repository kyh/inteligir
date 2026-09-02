import viteReact from "@vitejs/plugin-react";
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
        // The suites run the React Compiler's output, the code the renderer
        // bundle ships: a component it memoizes wrongly would otherwise pass
        // every unit test and fail only in the built app. The suites' own
        // files stay uncompiled — a fixture hook minted per test inside a
        // factory is a shape no source takes, and one the compiler hoists
        // wrongly (its closure lands at module scope, where the factory's
        // counter does not exist) with no diagnostic. The booted-dom project
        // below cannot share this — its ssr transform is the server consumer,
        // where the compiler plugin skips compilation.
        plugins: [viteReact({ compiler: true, exclude: [/\/node_modules\//, /\/__tests__\//] })],
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
