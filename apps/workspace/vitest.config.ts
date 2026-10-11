import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Compiled like the shipped bundle, so a component the compiler memoizes wrongly fails here
  // rather than only in the built app. Test files stay uncompiled: a fixture hook minted inside a
  // factory is hoisted to module scope with no diagnostic.
  plugins: [viteReact({ compiler: true, exclude: [/\/node_modules\//u, /\/__tests__\//u] })],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    maxWorkers: 2,
    setupFiles: [
      "src/app/__tests__/jsdom-stubs.ts",
      "src/app/__tests__/dom-timeouts.ts",
      "src/app/__tests__/console-error-gate.ts",
    ],
  },
});
