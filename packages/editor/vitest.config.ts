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
    // Budgeted against the rest of the monorepo's suites, which turbo runs in
    // parallel: uncapped pools exhaust the machine and kill workers mid-run.
    maxWorkers: 2,
    projects: [
      {
        plugins,
        resolve: { alias },
        test: {
          name: "editor",
          environment: "node",
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
          server: { deps: { inline: inlineDeps } },
        },
      },
    ],
  },
});
