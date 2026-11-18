import path from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const TYPING_BUDGET = "src/typing-budget.test.tsx";

const DOM_SETUP = [
  "src/test-support/dom-cleanup.test-utils.ts",
  "src/test-support/jsdom-stubs.test-utils.ts",
];

const reactCompiler = async () =>
  await babel({
    exclude: [
      /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/u,
      /\.test\.tsx?$/u,
      /\/test-support\//u,
    ],
    presets: [reactCompilerPreset()],
  });

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@repo/editor": path.resolve(import.meta.dirname, "src") } },
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          execArgv: ["--max-old-space-size=512"],
          include: ["src/**/*.test.ts"],
          name: "editor",
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        plugins: [reactCompiler()],
        test: {
          environment: "jsdom",
          exclude: [...configDefaults.exclude, TYPING_BUDGET],
          include: ["src/**/*.test.tsx"],
          name: "editor-dom",
          setupFiles: DOM_SETUP,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        plugins: [reactCompiler()],
        test: {
          environment: "jsdom",
          execArgv: ["--max-old-space-size=4096"],
          include: [TYPING_BUDGET],
          name: "editor-budget",
          setupFiles: DOM_SETUP,
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
