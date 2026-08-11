import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(import.meta.dirname, "src"),
  "@renderer": resolve(import.meta.dirname, "src/renderer"),
};

// @platejs/math imports katex's css at module top; inlining routes the package
// through vite so the css import is stubbed — plain node ESM would crash on the
// .css extension.
const inlineDeps = [/@platejs\/math/];

// The renderer's kit-parity test imports the live editor module
// (markdown-editor.tsx), which pulls in @repo/ui .tsx sources — they need the
// JSX transform. Harmless to the node-only main-process tests.
const plugins = [react()];

export default defineConfig({
  test: {
    // Worker caps are budgeted across the monorepo: turbo runs all five
    // package suites in parallel, and uncapped pools (10 threads each)
    // exhaust the machine and kill workers mid-run. Budget sums to ~9 on a
    // 10-core machine: desktop 3 (largest suite), features/core 2,
    // mobile/cloud 1.
    maxWorkers: 3,
    projects: [
      {
        plugins,
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          server: { deps: { inline: inlineDeps } },
        },
      },
      {
        // jsdom project for renderer component/hook tests (.test.tsx).
        plugins,
        resolve: { alias },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/renderer/**/*.test.tsx"],
          // Fills the browser APIs jsdom omits but renderer components use.
          setupFiles: ["./src/renderer/__tests__/dom-setup.ts"],
          server: { deps: { inline: inlineDeps } },
        },
      },
    ],
  },
});
