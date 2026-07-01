import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The kit-parity test imports the live editor module (markdown-editor.tsx),
  // which pulls in @repo/ui .tsx sources — they need the JSX transform.
  plugins: [react()],
  resolve: {
    // The package is source-only with no exports map (an `exports` fallback
    // array resolves inconsistently across TS/Vite/node); every host pins
    // `@repo/app` to ./src instead — including its own tests.
    alias: { "@repo/app": fileURLToPath(new URL("./src", import.meta.url)) },
  },
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
});
