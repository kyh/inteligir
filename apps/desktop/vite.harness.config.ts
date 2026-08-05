import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser dev harness — the fastest UI loop, no Electron and no backend.
// `dev/main.tsx` installs an in-memory fixture Bridge so the whole renderer UI
// runs in a plain browser. The UI is source-imported from @repo/workspace.
const configDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "dev",
  // Per the package's vite guidance: esbuild prebundling breaks the wasm
  // module's own asset resolution — serve its ESM as-is.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      // `@` → src, matching electron.vite/vitest — the HTML-App view imports the
      // shared runtime-injection module (`@/html-app-inject`) for its blob
      // fallback.
      "@": resolve(configDir, "src"),
      "@repo/workspace": resolve(configDir, "../../packages/workspace/src"),
      "@repo/editor": resolve(configDir, "../../packages/editor/src"),
    },
  },
});
