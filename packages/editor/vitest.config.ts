import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@repo/editor": path.resolve(import.meta.dirname, "src") };

// @platejs/math imports katex's css at module top; inlining routes it through vite so the css
// import is stubbed.
const inlineDeps = [/@platejs\/math/u];

// kit-parity pulls @repo/ui .tsx sources, which need the jsx transform in the node project too.
const plugins = [react()];

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        plugins,
        resolve: { alias },
        test: {
          include: ["src/**/*.test.ts"],
          name: "editor",
          server: { deps: { inline: inlineDeps } },
        },
      },
      {
        plugins,
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
