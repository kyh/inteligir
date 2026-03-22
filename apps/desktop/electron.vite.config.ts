import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load .env file and return define-compatible entries for process.env injection. */
function loadDotEnv(...prefixes: string[]): Record<string, string> {
  const defs: Record<string, string> = {};
  const result = dotenvConfig({ path: resolve(__dirname, ".env") });
  if (result.parsed) {
    for (const [key, value] of Object.entries(result.parsed)) {
      if (prefixes.some((p) => key.startsWith(p))) {
        defs[`process.env.${key}`] = JSON.stringify(value);
      }
    }
  }
  return defs;
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __PROJECT_ROOT__: JSON.stringify(__dirname),
      // Only inline the public URL — never embed API key/secret in the bundle.
      // The main process reads LIVEKIT_API_KEY and LIVEKIT_API_SECRET from .env
      // at runtime via dotenv (see main/index.ts).
      ...loadDotEnv("LIVEKIT_URL"),
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
});
