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
          server: { deps: { inline: inlineDeps } },
        },
      },
    ],
  },
});
