import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// No self-name alias on purpose: sources/tests import each other with
// relative paths; cross-package imports resolve through workspace exports.
export default defineConfig({
  // Compiled like the shipped renderer, so a component the compiler memoizes
  // wrongly fails here rather than only in the built app. Test files stay
  // uncompiled: a fixture hook minted inside a factory is hoisted to module
  // scope with no diagnostic. The compiler skips the ssr transform, so only the
  // suites that declare jsdom run compiled.
  plugins: [viteReact({ compiler: true, exclude: [/\/node_modules\//u, /\/__tests__\//u] })],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    maxWorkers: 2,
  },
});
