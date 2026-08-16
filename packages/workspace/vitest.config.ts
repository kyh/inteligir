import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@repo/workspace": resolve(import.meta.dirname, "src"),
  "@repo/editor": resolve(import.meta.dirname, "../editor/src"),
};

const inlineDeps = [/@platejs\/math/];
const plugins = [react()];

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        plugins,
        resolve: { alias },
        test: {
          name: "workspace",
          environment: "node",
          include: ["src/**/*.test.ts"],
          server: { deps: { inline: inlineDeps } },
        },
      },
      {
        plugins,
        resolve: { alias },
        test: {
          name: "workspace-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          // Fills the browser APIs jsdom omits but workspace components use.
          setupFiles: ["./src/__tests__/dom-setup.ts"],
          // These mount real component trees under jsdom while the Workers
          // pool runs workerd beside them, so vitest's 5s default is a
          // coin-flip under a full `turbo run test` and passes alone. A flaky
          // test is worse than a slow one — it teaches the reader to re-run.
          testTimeout: 20_000,
          server: { deps: { inline: inlineDeps } },
        },
      },
    ],
  },
});
