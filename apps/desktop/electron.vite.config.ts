import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";

const configDir = dirname(fileURLToPath(import.meta.url));

// One bundle: the main process. There is no preload and no renderer — the
// window loads the deployment named below, and everything it renders is served
// from there.
export default defineConfig(() => ({
  main: {
    define: {
      // The origin a packaged build points at, baked in at build time.
      // `INTELIGIR_APP_URL` overrides it at RUNTIME too (app-url.ts), which is
      // what points a local build at `pnpm dev:web`; an empty define falls
      // through to the shipped default rather than to an empty origin.
      BUNDLED_APP_URL: JSON.stringify(process.env["INTELIGIR_APP_URL"] ?? ""),
    },
    resolve: {
      alias: {
        "@": resolve(configDir, "src"),
      },
    },
    build: {
      externalizeDeps: false,
      outDir: ".output/app/main",
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(configDir, "src/main/index.ts"),
        },
      },
    },
  },
}));
