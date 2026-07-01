import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser dev harness only — the package is source-imported by its hosts and
// has no build output. `dev/main.tsx` installs an in-memory fixture Bridge so
// the whole UI runs in a plain browser.
export default defineConfig({
  root: "dev",
  plugins: [tailwindcss(), react()],
  resolve: {
    // esbuild's dependency scanner can't follow package self-references
    // (`@repo/app/*` from inside the package), so pin them to ./src here.
    alias: { "@repo/app": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
