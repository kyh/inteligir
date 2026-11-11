import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// the Worker's code and its suites are @repo/service's
export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        // the site's suites, which render its routes to a string as the Worker's SSR does
        test: {
          exclude: [...configDefaults.exclude, "src/library/**"],
          include: ["src/**/*.test.ts"],
          name: "site",
        },
      },
      {
        // The library's suites, under jsdom, compiled like the shipped bundle, so a component the
        // compiler memoizes wrongly fails here rather than only in the built page. Test files stay
        // uncompiled: a fixture hook minted inside a factory is hoisted to module scope with no
        // diagnostic.
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
          include: ["src/library/**/*.test.ts", "src/library/**/*.test.tsx"],
          name: "library",
          setupFiles: [
            "src/library/test-support/jsdom-stubs.ts",
            "src/library/test-support/dom-timeouts.ts",
            "src/library/test-support/console-error-gate.ts",
          ],
        },
      },
    ],
  },
});
