import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { LibraryFormats } from "vite";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => ({
  main: {
    define: {
      PROJECT_ROOT: JSON.stringify(configDir),
      // Bundled Google OAuth client, baked into the main bundle at build time
      // (main/executor/google-oauth-client.ts). A Google "Desktop app" type
      // client — its secret is non-confidential by Google's installed-app
      // spec, so shipping it in the binary is expected. Release builds run
      // under `pnpm with-env` (dotenv -e .env), which is what populates these;
      // empty/absent vars → no bundled client → the GCP-dialog flow remains.
      // Dev (`electron-vite dev` runs without with-env) falls back to reading
      // process.env at runtime after main loads apps/desktop/.env.
      // Root `pnpm build` goes through turbo: turbo.json's @repo/desktop#build
      // entry lists both vars in `env` so strict mode passes them through and
      // the cache invalidates when they change (else: stale clientless bundle).
      BUNDLED_GOOGLE_OAUTH_CLIENT_ID: JSON.stringify(
        process.env["INTELIGIR_GOOGLE_OAUTH_CLIENT_ID"] ?? "",
      ),
      BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET: JSON.stringify(
        process.env["INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET"] ?? "",
      ),
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
        // sherpa-onnx-node loads a native .node addon via __dirname-relative
        // paths. Bundling it breaks that lookup (the bundle's __dirname is the
        // chunks dir, not the package). Externalize so it's require()'d from
        // node_modules at runtime, where the addon + dylibs sit beside it.
        external: ["electron", "sherpa-onnx-node"],
        input: {
          index: resolve(configDir, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      outDir: ".output/app/preload",
      lib: {
        entry: resolve(configDir, "src/preload/index.ts"),
        formats: ["cjs"] satisfies LibraryFormats[],
      },
      rollupOptions: {
        // Externalize "electron" so the preload bundle uses the runtime API
        // (contextBridge, ipcRenderer) provided at load time instead of
        // inlining the npm package's binary-path loader.
        external: ["electron"],
        output: {
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        "@": resolve(configDir, "src"),
        // The renderer UI (the whole workspace) lives under src/renderer;
        // `@renderer` is its internal import root.
        "@renderer": resolve(configDir, "src/renderer"),
      },
    },
    build: {
      outDir: ".output/app/renderer",
      rollupOptions: {
        input: {
          index: resolve(configDir, "src/renderer/index.html"),
        },
      },
    },
  },
}));
