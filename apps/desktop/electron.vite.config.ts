import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { LibraryFormats } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => ({
  main: {
    plugins: [],
    define: {
      __PROJECT_ROOT__: JSON.stringify(__dirname),
    },
    resolve: {
      alias: { "@": resolve(__dirname, "src") },
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
          index: resolve(__dirname, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [],
    resolve: {
      alias: { "@": resolve(__dirname, "src") },
    },
    build: {
      outDir: ".output/app/preload",
      lib: {
        entry: resolve(__dirname, "src/preload/index.ts"),
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
      alias: { "@": resolve(__dirname, "src") },
    },
    build: {
      outDir: ".output/app/renderer",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
      },
    },
  },
}));
