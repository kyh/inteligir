import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: { include: ["vite/**/*.test.ts"], name: "extension-build" },
      },
      {
        // compiled like the shipped pages, so a component the compiler memoizes wrongly fails here.
        // Test files stay uncompiled: a fixture hook minted inside a factory is hoisted to module
        // scope with no diagnostic.
        plugins: [viteReact({ compiler: true, exclude: [/\/node_modules\//u, /\/__tests__\//u] })],
        test: {
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          name: "extension",
        },
      },
    ],
  },
});
