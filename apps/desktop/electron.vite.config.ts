import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Parse .env file into define-compatible entries for process.env injection. */
function loadDotEnv(...prefixes: string[]): Record<string, string> {
  const defs: Record<string, string> = {};
  try {
    for (const line of readFileSync(resolve(__dirname, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      const key = m?.[1];
      if (key && prefixes.some((p) => key.startsWith(p))) {
        defs[`process.env.${key}`] = JSON.stringify(m?.[2]);
      }
    }
  } catch { /* .env missing — ok */ }
  return defs;
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __PROJECT_ROOT__: JSON.stringify(__dirname),
      ...loadDotEnv("LIVEKIT_"),
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
