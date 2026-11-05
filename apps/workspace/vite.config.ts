import path from "node:path";
import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Logger } from "babel-plugin-react-compiler";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const src = path.resolve(here, "src");

// the prefix the Worker serves the page under, which every asset url the build writes starts with
const BASE = `${LIBRARY_PAGE_PATH}/`;

// pinned: `tauri dev` waits on it (`devUrl` in apps/desktop/src-tauri/tauri.conf.json), clear of
// `pnpm dev:web`'s 5174
const DEV_PORT = 31_000;

// a component the compiler skipped, said as the build runs (react.dev/reference/react-compiler/
// logger): the card grid is the one it may name (packages/ui/CLAUDE.md § THE CARD GRID IS
// VIRTUALIZED BY UNIFORM ROWS)
const reportSkips: Logger = {
  logEvent: (filename, event) => {
    if (event.kind !== "CompileError" && event.kind !== "PipelineError") {
      return;
    }
    const at = event.fnLoc === null ? "" : `:${String(event.fnLoc.start.line)}`;
    const why = event.kind === "CompileError" ? event.detail.reason : event.data;
    console.warn(`React Compiler skipped ${filename ?? "a module"}${at}: ${why}`);
  },
};

export default defineConfig({
  base: BASE,
  build: {
    // one script on purpose (below), about 4.4 MB and 1.4 MB compressed, so the ceiling (kB) is
    // there to catch a dependency that doubles it
    chunkSizeWarningLimit: 6000,
    emptyOutDir: true,
    outDir: path.resolve(here, "dist"),
    rolldownOptions: {
      input: path.resolve(src, "index.html"),
      // CLAUDE.md § THE PAGE IS ONE BUNDLE: every dynamic import (the editor's lazy nodes: KaTeX,
      // Mermaid, the calendar, the wiki chip) is inlined, so nothing is fetched after the page
      // loads, and a tab that lost its connection never meets a chunk it cannot fetch
      output: { codeSplitting: false },
    },
  },
  clearScreen: false,
  // SQLite's wasm loads its own module beside it, which the dep optimizer would move away from it
  // (https://www.npmjs.com/package/@sqlite.org/sqlite-wasm#usage-with-vite)
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  plugins: [
    tanstackRouter({
      // one bundle (above): a route split off would be a lazy import inlined straight back
      autoCodeSplitting: false,
      generatedRouteTree: path.resolve(src, "routeTree.gen.ts"),
      routesDirectory: path.resolve(src, "routes"),
      target: "react",
    }),
    viteReact(),
    // the React Compiler, react.dev's Vite path (react.dev/learn/react-compiler/installation)
    babel({ presets: [reactCompilerPreset({ logger: reportSkips })] }),
    tailwindcss(),
  ],
  root: src,
  server: { port: DEV_PORT, strictPort: true },
});
