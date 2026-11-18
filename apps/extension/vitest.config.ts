import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

import { WORKER_CONDITIONS } from "./worker-conditions.ts";

export default defineConfig({
  plugins: [WxtVitest({ root: import.meta.dirname })],
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
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
        plugins: [
          viteReact(),
          babel({
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
