import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The renderer's kit-parity test imports the live editor module
  // (markdown-editor.tsx), which pulls in @repo/ui .tsx sources — they need the
  // JSX transform. Harmless to the node-only main-process tests.
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        // @platejs/math imports katex's css at module top; inlining routes the
        // package through vite so the css import is stubbed — plain node ESM
        // would crash on the .css extension.
        inline: [/@platejs\/math/],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "@renderer": resolve(import.meta.dirname, "src/renderer"),
    },
  },
});
