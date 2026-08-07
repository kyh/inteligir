import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(import.meta.dirname, "src"),
  "@repo/workspace": resolve(import.meta.dirname, "../../packages/workspace/src"),
  "@repo/editor": resolve(import.meta.dirname, "../../packages/editor/src"),
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
    // Worker caps are budgeted against the machine, not this suite: turbo runs
    // the package suites in parallel and uncapped pools exhaust a 10-core box
    // and kill workers mid-run. The budget has two halves and BOTH are load
    // bearing — this per-package cap, and `--concurrency` on the root `test`
    // script, which bounds how many packages hold pools at once. Raising
    // either alone reintroduces the flake.
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
        // jsdom: the vendored HTML-app runtime is evaluated into a window.
        plugins,
        resolve: { alias },
        test: {
          name: "desktop-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          server: { deps: { inline: inlineDeps } },
        },
      },
    ],
  },
});
