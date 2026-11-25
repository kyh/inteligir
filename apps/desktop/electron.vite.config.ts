import path from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      license: { fileName: "notices/npm-packages.md" },
      outDir: ".output/app/main",
      rolldownOptions: {
        input: { index: path.resolve(import.meta.dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: ".output/app/preload",
      rolldownOptions: {
        input: { index: path.resolve(import.meta.dirname, "src/preload/index.ts") },
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
  },
});
