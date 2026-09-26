import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { classicPage } from "./vite/classic-page";

export default defineConfig({
  // relative: the phone loads the page from its own bundle, as file://
  base: "./",
  build: {
    // a font the page fetches from file:// rides a CSP 'self' whose reading of file: differs by
    // engine, so every woff2 is inlined; the older formats beside it in @font-face are never
    // fetched by a WebView that reads woff2
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? true : undefined),
    // one script on purpose, read from the phone's own disk rather than the network (mermaid alone
    // is most of it), so the ceiling (kB) is there to catch a dependency that doubles it
    chunkSizeWarningLimit: 12_000,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: {
      // vite hands each dynamic import `import.meta.url` for its preload helper, which an IIFE
      // empties; with every import inlined there is nothing left to preload, and no source reads it
      checks: { emptyImportMeta: false },
      // one IIFE, the dynamic imports (mermaid, katex, the calendar, the wiki chip) inlined
      output: { codeSplitting: false, format: "iife" },
    },
  },
  plugins: [viteReact({ compiler: true }), tailwindcss(), classicPage()],
});
