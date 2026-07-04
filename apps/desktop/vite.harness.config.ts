import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser dev harness — the fastest UI loop, no Electron and no backend.
// `dev/main.tsx` installs an in-memory fixture Bridge so the whole renderer UI
// runs in a plain browser. The renderer is source-imported via `@renderer`.
export default defineConfig({
  root: "dev",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { "@renderer": fileURLToPath(new URL("./src/renderer", import.meta.url)) },
  },
});
