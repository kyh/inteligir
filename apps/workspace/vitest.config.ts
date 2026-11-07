import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Compiled like the shipped bundle, so a component the compiler memoizes wrongly fails here
  // rather than only in the built app. Test files stay uncompiled: a fixture hook minted inside a
  // factory is hoisted to module scope with no diagnostic.
  plugins: [
    viteReact(),
    babel({
      // the plugin's own default (node_modules and rolldown's runtime), which an exclude replaces
      exclude: [
        /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/u,
        /\.test\.tsx?$/u,
        /\/test-support\//u,
      ],
      presets: [reactCompilerPreset()],
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    maxWorkers: 2,
    setupFiles: [
      "src/app/test-support/jsdom-stubs.ts",
      "src/app/test-support/dom-timeouts.ts",
      "src/app/test-support/console-error-gate.ts",
    ],
  },
});
