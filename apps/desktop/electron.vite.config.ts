import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

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
        external: ["electron"],
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
        formats: ["cjs"],
      },
      rollupOptions: {
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
