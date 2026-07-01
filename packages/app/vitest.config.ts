import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
