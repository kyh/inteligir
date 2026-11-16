import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// the Worker's code and its suites are @repo/service's
export default defineConfig({
  // What the library's two projects extend, and the site's does not. Compiled like the shipped
  // bundle, so a component the compiler memoizes wrongly fails here rather than only in the built
  // page. Test files stay uncompiled: a fixture hook minted inside a factory is hoisted to module
  // scope with no diagnostic.
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
    maxWorkers: 2,
    // the unmount after the gate: an afterEach registered later runs sooner, and a gate that throws
    // ends the hooks behind it, which would leave a logged test's tree mounted for the next
    setupFiles: [
      "src/library/test-support/jsdom-stubs.ts",
      "src/library/test-support/console-error-gate.ts",
      "src/library/test-support/dom-cleanup.ts",
    ],
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
        // under node; a suite that needs a document and draws no JSX says so in vitest's docblock
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
