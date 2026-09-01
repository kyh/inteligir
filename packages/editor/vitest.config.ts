import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@repo/editor": resolve(import.meta.dirname, "src") };

// @platejs/math imports katex's css at module top; inlining routes the package
// through vite so the css import is stubbed — plain node ESM would crash on the
// .css extension.
const inlineDeps = [/@platejs\/math/];

// kit-parity imports the live editor module, which pulls in @repo/ui .tsx
// sources — they need the JSX transform even in the node project.
const plugins = [react()];

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        plugins,
        resolve: { alias },
        test: {
          name: "editor",
          include: ["src/**/*.test.ts"],
          server: { deps: { inline: inlineDeps } },
        },
      },
      {
        plugins,
        resolve: { alias },
        test: {
          name: "editor-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          // Mounts real Plate trees beside the Workers pool; 5s is a coin-flip
          // under a full run and passes alone.
          testTimeout: 20_000,
          server: { deps: { inline: inlineDeps } },
        },
      },
    ],
  },
});
