// the capture script, injected by executeScript({ files: ["capture.js"] }): one IIFE with nothing
// to import, written beside the pages' build without emptying it.

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    rolldownOptions: {
      input: "src/capture/capture.ts",
      output: { codeSplitting: false, entryFileNames: "capture.js", format: "iife" },
    },
  },
});
