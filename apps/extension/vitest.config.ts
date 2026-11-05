import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

import { WORKER_CONDITIONS } from "./worker-conditions.ts";

export default defineConfig({
  // WXT's own test setup for every suite: its fake `browser`, its globals and wxt.config.ts's
  // aliases
  plugins: [WxtVitest()],
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        // the service worker's modules, and the manifest it ships under, run as the worker runs
        // them: under node, with no `window`, `document` or `getComputedStyle`, and each package
        // resolved to the build the worker's own bundle takes. WxtVitest() applies none of
        // wxt.config.ts's vite options, so the conditions are named here too
        ssr: {
          resolve: { conditions: WORKER_CONDITIONS, externalConditions: WORKER_CONDITIONS },
        },
        test: {
          environment: "node",
          include: ["src/*.test.ts", "src/background/**/*.test.ts"],
          name: "extension-worker",
        },
      },
      {
        extends: true,
        // what runs in a page (the popup, and the capture script in the tab it saves), compiled
        // like the shipped pages, so a component the compiler memoizes wrongly fails here. Test
        // files stay uncompiled: a fixture hook minted inside a factory is hoisted to module scope
        // with no diagnostic.
        plugins: [
          viteReact(),
          babel({
            // the plugin's own default (node_modules and rolldown's runtime), which an exclude
            // replaces
            exclude: [
              /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/u,
              /\.test\.tsx?$/u,
              /\/test-support\//u,
            ],
            presets: [reactCompilerPreset()],
          }),
        ],
        test: {
          environment: "jsdom",
          include: ["src/capture/**/*.test.ts", "src/entrypoints/**/*.test.tsx"],
          name: "extension-pages",
        },
      },
    ],
  },
});
