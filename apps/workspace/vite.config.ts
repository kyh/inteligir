import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const src = path.resolve(here, "src");

// the prefix the Worker serves the page under (`@repo/contract/cloud/library-page`'s
// LIBRARY_PAGE_PATH), which every asset url the build writes starts with;
// tools/repo-guards/src/route-paths.test.ts holds the two equal
const BASE = "/library/";

// pinned: `tauri dev` waits on it (`devUrl` in apps/desktop/src-tauri/tauri.conf.json), clear of
// `pnpm dev:web`'s 5174
const DEV_PORT = 31_000;

export default defineConfig({
  base: BASE,
  build: {
    emptyOutDir: true,
    outDir: path.resolve(here, "dist"),
    rolldownOptions: { input: path.resolve(src, "index.html") },
  },
  clearScreen: false,
  // SQLite's wasm loads its own module beside it, which the dep optimizer would move away from it
  // (https://www.npmjs.com/package/@sqlite.org/sqlite-wasm#usage-with-vite)
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  // `compiler` loads the otherwise-unimported `oxc-transform-react` devDependency.
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      generatedRouteTree: path.resolve(src, "routeTree.gen.ts"),
      routesDirectory: path.resolve(src, "routes"),
      target: "react",
    }),
    viteReact({ compiler: { logDiagnostics: true } }),
    tailwindcss(),
  ],
  root: src,
  server: { port: DEV_PORT, strictPort: true },
});
