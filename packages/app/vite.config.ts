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
    // The package is source-only with no exports map (an `exports` fallback
    // array resolves inconsistently across TS/Vite/node); every host pins
    // `@repo/app` to ./src, including this harness.
    alias: { "@repo/app": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
