import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: { include: ["src/**/*.test.ts"], name: "ui" },
      },
      {
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
          include: ["src/**/*.test.tsx"],
          name: "ui-dom",
          setupFiles: [
            "src/test-support/dom-cleanup.test-utils.ts",
            "src/test-support/jsdom-stubs.test-utils.ts",
          ],
        },
      },
    ],
  },
});
