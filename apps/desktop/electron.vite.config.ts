import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `electron` is the RUNTIME, never a module to bundle. Stated here rather than
 * left to electron-vite's preset because Vite rebuilds `build.rollupOptions`
 * from the user config alone — a preset's `external` never reaches the resolved
 * config. Inlining it is silent: the npm package is a shim that resolves the
 * binary from its own `__dirname`, so a bundled copy looks for a `dist/` beside
 * the OUTPUT and tries to download Electron when the window opens.
 */
const ELECTRON_RUNTIME = ["electron", /^electron\/.+/];

/**
 * Both windows run `sandbox: true`, and a sandboxed preload has no ES module
 * loader — so the preloads are CommonJS, and the `.cjs` extension is
 * load-bearing in a `"type": "module"` package.
 */
const PRELOAD_OUTPUT = {
  format: "cjs",
  entryFileNames: "[name].cjs",
  chunkFileNames: "[name].cjs",
} as const;

/** The in-app browser's chrome bar: plain HTML, deliberately never built —
 *  everything it can do is the fixed verb set its preload exposes — so it is
 *  emitted verbatim beside the preload that gives it those verbs. */
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
    // Well clear of `pnpm dev:web`'s PINNED 5174: Vite's own search starts at
    // 5173 and would walk onto it, so a second worktree's shell would surface
    // as the marketing Worker refusing to start. Searching upward from here is
    // deliberate — nothing needs this port to be stable, main is handed the URL
    // as ELECTRON_RENDERER_URL.
    server: { port: 31_000 },
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: resolve(here, "src/renderer/routes"),
        generatedRouteTree: resolve(here, "src/renderer/routeTree.gen.ts"),
        autoCodeSplitting: true,
      }),
      // `compiler: true` loads the optional peer `oxc-transform-react` — that
      // peer is the devDependency's only consumer.
      viteReact({ compiler: true }),
      tailwindcss(),
    ],
    build: {
      outDir: resolve(here, ".output/app/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(here, "src/renderer/index.html") } },
    },
  },
});
