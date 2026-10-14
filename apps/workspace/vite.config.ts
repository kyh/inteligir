import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const src = path.resolve(here, "src");

// Two builds: the CLI stages the app page for every vault's server to answer
// (apps/cli/scripts/build.ts), and the shell embeds the first-run page alone (`frontendDist` in
// apps/desktop/src-tauri/tauri.conf.json), since the first run opens before any server exists.
const PAGES = {
  app: { input: "index.html", outDir: "dist/app" },
  "first-run": { input: "first-run.html", outDir: "dist/first-run" },
} as const;

// fixed because `tauri dev` (`devUrl`) and scripts/dev.ts both name it; clear of `pnpm dev:web`'s
// pinned 5174, which Vite's default search from 5173 walks onto
const DEV_PORT = 31_000;

export default defineConfig(({ mode }) => {
  const page = mode === "first-run" ? PAGES["first-run"] : PAGES.app;
  return {
    build: {
      emptyOutDir: true,
      outDir: path.resolve(here, page.outDir),
      rolldownOptions: { input: path.resolve(src, page.input) },
    },
    // tauri dev prints the shell's own lines into this terminal
    clearScreen: false,
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
    server: {
      // the page's files arrive through its server, but the hot-reload socket dials here directly
      hmr: { clientPort: DEV_PORT, host: "localhost" },
      port: DEV_PORT,
      strictPort: true,
    },
  };
});
