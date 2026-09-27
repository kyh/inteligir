import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { build as buildVite } from "vite";
import type { Plugin } from "vite";

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

// every dependency is inlined, stated rather than left to the rebuild above that drops the
// preset's `external` today: `inteligir`'s server modules export TS source Node cannot load, and
// a sandboxed preload can require no package at all.
const EXTERNALIZE_DEPS = false;

const PRELOAD_OUT_DIR = path.resolve(here, ".output/app/preload");

const SRC_DIR = path.resolve(here, "src");
const FIRST_RUN_PRELOAD_ENTRY = path.resolve(SRC_DIR, "preload/first-run.ts");

// A sandboxed preload can require no file beside it, and two inputs to one build put whatever both
// import in a chunk of its own, which each would require and neither could load. So the first-run
// window's preload is a build of its own, run each time the app window's is written (every rebuild
// under `pnpm dev` included). Not electron-vite's `isolatedEntries`: it reports progress through
// TTY-only stdout calls, so it throws under turbo and CI.
const firstRunPreload = (): Plugin => {
  // the app window's graph never reaches these, so `pnpm dev` watches them for it: an edit to one
  // then rebuilds the app window's preload, whose write rebuilds this one
  let watched = new Set([FIRST_RUN_PRELOAD_ENTRY]);
  return {
    apply: "build",
    buildStart() {
      for (const id of watched) {
        this.addWatchFile(id);
      }
    },
    name: "inteligir:first-run-preload",
    async writeBundle() {
      const built = await buildVite({
        build: {
          emptyOutDir: false,
          lib: {
            entry: FIRST_RUN_PRELOAD_ENTRY,
            fileName: () => "first-run.cjs",
            formats: ["cjs"],
          },
          minify: false,
          outDir: PRELOAD_OUT_DIR,
          rolldownOptions: { external: ELECTRON_RUNTIME },
        },
        configFile: false,
        logLevel: "warn",
        publicDir: false,
        root: here,
      });
      if (!Array.isArray(built) && !("output" in built)) {
        return;
      }
      const moduleIds = [built]
        .flat()
        .flatMap(({ output }) =>
          output.flatMap((item) => (item.type === "chunk" ? item.moduleIds : [])),
        );
      watched = new Set([
        FIRST_RUN_PRELOAD_ENTRY,
        ...moduleIds.filter((id) => id.startsWith(`${SRC_DIR}${path.sep}`)),
      ]);
    },
  };
};

export default defineConfig({
  main: {
    build: {
      externalizeDeps: EXTERNALIZE_DEPS,
      outDir: ".output/app/main",
      rolldownOptions: {
        external: ELECTRON_RUNTIME,
        input: { index: path.resolve(here, "src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: EXTERNALIZE_DEPS,
      outDir: PRELOAD_OUT_DIR,
      rolldownOptions: {
        external: ELECTRON_RUNTIME,
        input: { index: path.resolve(here, "src/preload/index.ts") },
        output: PRELOAD_OUTPUT,
      },
    },
    plugins: [firstRunPreload()],
  },
  renderer: {
    build: {
      emptyOutDir: true,
      outDir: path.resolve(here, ".output/app/renderer"),
      rolldownOptions: {
        input: {
          "first-run": path.resolve(here, "src/renderer/first-run.html"),
          index: path.resolve(here, "src/renderer/index.html"),
        },
      },
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
