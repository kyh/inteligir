import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const renderer = path.resolve(here, "src/renderer");

// Two pages, each its own build. The app page is what every vault's server answers: the CLI stages
// it as its UI (apps/cli/scripts/build.mjs), and the shell's window loads it from that server's
// own origin. The first run opens before any server exists, so the shell embeds that page alone
// (`frontendDist` in src-tauri/tauri.conf.json) rather than carrying the app page twice.
const PAGES = {
  app: { input: "index.html", outDir: "dist/app" },
  "first-run": { input: "first-run.html", outDir: "dist/first-run" },
} as const;

// `tauri dev` waits on it (`devUrl`), and a dev server forwards the app page's files to it, so the
// window keeps its server's origin and still reloads in place. Clear of `pnpm dev:web`'s pinned
// 5174: Vite's default search from 5173 walks onto it.
const DEV_PORT = 31_000;

export default defineConfig(({ mode }) => {
  const page = mode === "first-run" ? PAGES["first-run"] : PAGES.app;
  return {
    build: {
      emptyOutDir: true,
      outDir: path.resolve(here, page.outDir),
      rolldownOptions: { input: path.resolve(renderer, page.input) },
    },
    // tauri dev prints the shell's own lines into this terminal
    clearScreen: false,
    // `compiler` loads the otherwise-unimported `oxc-transform-react` devDependency.
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        generatedRouteTree: path.resolve(renderer, "routeTree.gen.ts"),
        routesDirectory: path.resolve(renderer, "routes"),
        target: "react",
      }),
      viteReact({ compiler: { logDiagnostics: true } }),
      tailwindcss(),
    ],
    root: renderer,
    server: {
      // the page's files arrive through its server, but the hot-reload socket dials here directly
      hmr: { clientPort: DEV_PORT, host: "localhost" },
      port: DEV_PORT,
      strictPort: true,
    },
  };
});
