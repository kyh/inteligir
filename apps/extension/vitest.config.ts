import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WXT's own test setup (its fake `browser`, its globals and wxt.config.ts's aliases), and the
  // pages compiled like the shipped ones, so a component the compiler memoizes wrongly fails here.
  // Test files stay uncompiled: a fixture hook minted inside a factory is hoisted to module scope
  // with no diagnostic.
  plugins: [
    WxtVitest(),
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
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    maxWorkers: 2,
    name: "extension",
  },
});
