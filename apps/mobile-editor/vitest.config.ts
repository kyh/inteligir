import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: { include: ["vite/**/*.test.ts"], name: "mobile-editor-build" },
      },
      {
        // Compiled like the shipped page, so a component the compiler memoizes wrongly fails here
        // rather than only on the phone. Test files stay uncompiled: a fixture hook minted inside
        // a factory is hoisted to module scope with no diagnostic.
        plugins: [viteReact({ compiler: true, exclude: [/\/node_modules\//u, /\/__tests__\//u] })],
        test: {
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          name: "mobile-editor",
          setupFiles: ["src/__tests__/dom-setup.ts"],
          // a real Plate tree mounts beside the other suites; 5s is a coin-flip under a full run
          testTimeout: 20_000,
        },
      },
    ],
  },
});
