import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // Pin the dev port, and REFUSE to drift off it: every doc and script names
  // :5174, and failing to bind is the loud version of moving.
  server: { port: 5174, strictPort: true },
  // `@/*` is declared in tsconfig paths only. `vite build` resolves it (the
  // start plugin reads tsconfig), but the dev SSR runner does not — `vite dev`
  // 500'd with "Cannot find module '@/lib/site-config'". Declare it for both.
  resolve: {
    alias: { "@": src },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // Start would otherwise take `src/server.ts` as the server entry. The entry
    // lives with the rest of the Worker instead, because that directory is its
    // own tsconfig program (see src/worker/tsconfig.json) — and the entry,
    // which names `Env`, has to be inside it.
    tanstackStart({ server: { entry: "./worker/server.ts" } }),
    viteReact(),
    tailwindcss(),
  ],
});
