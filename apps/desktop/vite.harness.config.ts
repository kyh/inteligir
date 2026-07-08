import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser dev harness — the fastest UI loop, no Electron and no backend.
// `dev/main.tsx` installs an in-memory fixture Bridge so the whole renderer UI
// runs in a plain browser. The renderer is source-imported via `@renderer`.
const configDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "dev",
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: resolve(configDir, "src/renderer/routes"),
      generatedRouteTree: resolve(configDir, "src/renderer/routeTree.gen.ts"),
      autoCodeSplitting: false,
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@renderer": resolve(configDir, "src/renderer"),
      // `@` → src, matching electron.vite/vitest — the HTML-App view imports the
      // shared runtime-injection module (`@/html-app-inject`) for its blob
      // fallback.
      "@": resolve(configDir, "src"),
    },
  },
});
