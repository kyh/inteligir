import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "electron-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Native modules that can't be bundled by Vite — must stay in node_modules
const nativeExternals = [
  "koffi",
  "onnxruntime-node",
  "sharp",
  "@img/sharp-darwin-arm64",
  "@livekit/rtc-node",
  "@livekit/agents-plugin-silero",
];

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [],
    define: {
      __PROJECT_ROOT__: JSON.stringify(__dirname),
      // Expose LIVEKIT_URL as an explicit build-time constant so sidecar
      // forwarding doesn't depend on Vite's process.env replacement behavior.
      // Secrets (API key/secret) are loaded at runtime via process.loadEnvFile()
      // so they don't end up as string literals in the compiled bundle.
      __LIVEKIT_URL__: JSON.stringify(loadEnv(mode, __dirname, "LIVEKIT_URL").LIVEKIT_URL ?? ""),
    },
    resolve: {
      alias: { "@": resolve(__dirname, "src") },
    },
    build: {
      externalizeDeps: false,
      outDir: ".output/app/main",
      rollupOptions: {
        external: [...nativeExternals, "electron"],
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          worker: resolve(__dirname, "src/agent/worker.ts"),
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
