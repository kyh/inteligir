import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// No self-name alias on purpose: sources/tests import each other with
// relative paths; cross-package imports resolve through workspace exports.
export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        // no compiler: it would be inert, since it skips the ssr transform a node project runs
        test: { include: ["src/**/*.test.ts"], name: "ui" },
      },
      {
        // Compiled like the shipped page, so a component the compiler memoizes
        // wrongly fails here rather than only in the built app. Test files stay
        // uncompiled: a fixture hook minted inside a factory is hoisted to module
        // scope with no diagnostic.
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
          include: ["src/**/*.test.tsx"],
          name: "ui-dom",
          setupFiles: ["src/test-support/dom-cleanup.ts"],
        },
      },
    ],
  },
});
