import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@repo/editor": path.resolve(import.meta.dirname, "src") };

// @platejs/math imports katex's css at module top; inlining routes it through vite so the css
// import is stubbed.
const inlineDeps = [/@platejs\/math/u];

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        // kit-parity pulls @repo/ui .tsx sources, which need the jsx transform here too. The
        // compiler would be inert: it skips the ssr transform a node project runs.
        plugins: [react()],
        resolve: { alias },
        test: {
          include: ["src/**/*.test.ts"],
          name: "editor",
          server: { deps: { inline: inlineDeps } },
        },
      },
      {
        // Compiled like the shipped renderer, so a component the compiler memoizes wrongly fails
        // here rather than only in the built app. Test files stay uncompiled: a fixture hook
        // minted inside a factory is hoisted to module scope with no diagnostic.
        plugins: [react({ compiler: true, exclude: [/\/node_modules\//u, /\/__tests__\//u] })],
        resolve: { alias },
        test: {
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          name: "editor-dom",
          server: { deps: { inline: inlineDeps } },
          setupFiles: ["src/__tests__/dom-cleanup.ts"],
          // real Plate trees mount beside the Workers pool; 5s is a coin-flip under a full run.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
