import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const BOOTED_DOM_SUITES = "src/**/*.booted.test.tsx";

const SETUP_FILES = ["src/renderer/app/__tests__/jsdom-stubs.ts"];

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        // Compiled like the shipped bundle, so a component the compiler
        // memoizes wrongly fails here rather than only in the built app. Test
        // files stay uncompiled: a fixture hook minted inside a factory is
        // hoisted to module scope with no diagnostic. The booted-dom project
        // cannot share this — the compiler plugin skips the ssr transform.
        plugins: [viteReact({ compiler: true, exclude: [/\/node_modules\//, /\/__tests__\//] })],
        test: {
          name: "desktop",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [...configDefaults.exclude, BOOTED_DOM_SUITES],
          setupFiles: SETUP_FILES,
        },
      },
      {
        test: {
          name: "desktop-booted-dom",
          environment: "./src/renderer/app/__tests__/jsdom-ssr-environment.ts",
          include: [BOOTED_DOM_SUITES],
          setupFiles: SETUP_FILES,
        },
      },
    ],
  },
});
