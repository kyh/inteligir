import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { nativeHostNameFor } from "./src/manifest";

export default defineConfig({
  // the dev build's host, as `wxt build` defines it (wxt.config.ts)
  define: { __INTELIGIR_NATIVE_HOST__: JSON.stringify(nativeHostNameFor("dev")) },
  // compiled like the shipped pages, so a component the compiler memoizes wrongly fails here. Test
  // files stay uncompiled: a fixture hook minted inside a factory is hoisted to module scope with no
  // diagnostic.
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
  // WXT's own `@`, its srcDir (wxt.config.ts), which the suites resolve without booting WXT
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    maxWorkers: 2,
    name: "extension",
  },
});
