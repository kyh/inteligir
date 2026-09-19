import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const here = import.meta.dirname;

// Vite rebuilds `build.rolldownOptions` from the user config alone, so electron-vite's
// preset `external` never applies; a bundled `electron` shim resolves the binary from
// its own `__dirname` and tries to download Electron when the window opens.
const ELECTRON_RUNTIME = ["electron", /^electron\/.+/u];

// a sandboxed preload has no ES module loader, so `.cjs` in a `"type": "module"` package.
const PRELOAD_OUTPUT = {
  chunkFileNames: "[name].cjs",
  entryFileNames: "[name].cjs",
  format: "cjs",
} as const;

export default defineConfig({
  main: {
    build: {
      outDir: ".output/app/main",
      rolldownOptions: {
        external: ELECTRON_RUNTIME,
        input: { index: path.resolve(here, "src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      outDir: ".output/app/preload",
      rolldownOptions: {
        external: ELECTRON_RUNTIME,
        input: {
          index: path.resolve(here, "src/preload/index.ts"),
        },
        output: PRELOAD_OUTPUT,
      },
    },
  },
  renderer: {
    build: {
      emptyOutDir: true,
      outDir: path.resolve(here, ".output/app/renderer"),
      rolldownOptions: { input: { index: path.resolve(here, "src/renderer/index.html") } },
    },
    // `compiler` loads the otherwise-unimported `oxc-transform-react` devDependency.
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        generatedRouteTree: path.resolve(here, "src/renderer/routeTree.gen.ts"),
        routesDirectory: path.resolve(here, "src/renderer/routes"),
        target: "react",
      }),
      viteReact({ compiler: { logDiagnostics: true } }),
      tailwindcss(),
    ],
    root: path.resolve(here, "src/renderer"),
    // clear of `pnpm dev:web`'s pinned 5174: Vite's default search from 5173 walks onto it.
    server: { port: 31_000 },
  },
});
