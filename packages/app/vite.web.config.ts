import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static web build (`pnpm build` → dist-web/), served by @repo/server. The
// in-memory dev harness stays in vite.config.ts; this entry installs the
// WebSocket Bridge instead of a fixture.
export default defineConfig({
  root: "web",
  plugins: [tailwindcss(), react()],
  resolve: {
    // Same pinning rationale as vite.config.ts: the package is source-only
    // with no exports map, so hosts alias `@repo/app` to ./src.
    alias: { "@repo/app": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-web", import.meta.url)),
    emptyOutDir: true,
  },
});
