import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Convert env vars matching prefixes into Vite `define` entries. */
function envDefines(mode: string, ...prefixes: string[]): Record<string, string> {
  const env = loadEnv(mode, __dirname, prefixes);
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
  );
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __PROJECT_ROOT__: JSON.stringify(__dirname),
      // Only inline the public URL — secrets (API key/secret) are loaded at
      // runtime via process.loadEnvFile() so they don't end up as string
      // literals in the compiled bundle.
      ...envDefines(mode, "LIVEKIT_URL"),
    },
    resolve: {
      alias: { "@": resolve(__dirname, "src") },
    },
    build: {
      outDir: ".output/app/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          worker: resolve(__dirname, "src/agent/worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
