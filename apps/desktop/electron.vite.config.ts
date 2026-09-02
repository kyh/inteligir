import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

// Vite rebuilds `build.rollupOptions` from the user config alone, so electron-vite's
// preset `external` never applies; a bundled `electron` shim resolves the binary from
// its own `__dirname` and tries to download Electron when the window opens.
const ELECTRON_RUNTIME = ["electron", /^electron\/.+/];

// a sandboxed preload has no ES module loader, so `.cjs` in a `"type": "module"` package.
const PRELOAD_OUTPUT = {
  format: "cjs",
  entryFileNames: "[name].cjs",
  chunkFileNames: "[name].cjs",
} as const;

function chromeBarPage(): Plugin {
  const source = resolve(here, "src/main/browser-chrome.html");
  return {
    name: "inteligir:chrome-bar-page",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "browser-chrome.html",
        source: readFileSync(source, "utf8"),
      });
    },
  };
}

export default defineConfig({
  main: {
    build: {
      outDir: ".output/app/main",
      rollupOptions: {
        input: { index: resolve(here, "src/main/index.ts") },
        external: ELECTRON_RUNTIME,
      },
    },
  },
  preload: {
    plugins: [chromeBarPage()],
    build: {
      outDir: ".output/app/preload",
      rollupOptions: {
        input: {
          index: resolve(here, "src/preload/index.ts"),
          "browser-preload": resolve(here, "src/main/browser-preload.ts"),
        },
        external: ELECTRON_RUNTIME,
        output: PRELOAD_OUTPUT,
      },
    },
  },
  renderer: {
    root: resolve(here, "src/renderer"),
    // clear of `pnpm dev:web`'s pinned 5174: Vite's default search from 5173 walks onto it.
    server: { port: 31_000 },
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: resolve(here, "src/renderer/routes"),
        generatedRouteTree: resolve(here, "src/renderer/routeTree.gen.ts"),
        autoCodeSplitting: true,
      }),
      // `compiler` loads the otherwise-unimported `oxc-transform-react` devDependency.
      viteReact({ compiler: { logDiagnostics: true } }),
      tailwindcss(),
    ],
    build: {
      outDir: resolve(here, ".output/app/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(here, "src/renderer/index.html") } },
    },
  },
});
