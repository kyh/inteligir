import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    viteReact(),
    babel({
      exclude: [
        /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/u,
        /\.test\.tsx?$/u,
        /\/test-support\//u,
      ],
      presets: [
        reactCompilerPreset({
          environment: { validateNoDynamicallyCreatedComponentsOrHooks: true },
        }),
      ],
    }),
  ],
  test: {
    maxWorkers: 2,
    setupFiles: [
      "src/library/test-support/jsdom-stubs.test-utils.ts",
      "src/library/test-support/console-error-gate.test-utils.ts",
      "src/library/test-support/dom-cleanup.test-utils.ts",
    ],
    projects: [
      {
        test: {
          exclude: [...configDefaults.exclude, "src/library/**"],
          include: ["src/**/*.test.ts"],
          name: "site",
        },
      },
      {
        extends: true,
        test: { include: ["src/library/**/*.test.ts"], name: "library" },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          include: ["src/library/**/*.test.tsx"],
          name: "library-dom",
        },
      },
    ],
  },
});
