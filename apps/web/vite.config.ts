import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // Pin the dev port. Vite's default is 5173 — which is also the desktop
  // harness (`pnpm -F @repo/desktop dev:harness`), so `pnpm dev` silently
  // bumped one of the two and nothing could name the web app's URL.
  server: { port: 5174 },
  // `@/*` is declared in tsconfig paths only. `vite build` resolves it (the
  // start plugin reads tsconfig), but the dev SSR runner does not — `vite dev`
  // 500'd with "Cannot find module '@/lib/site-config'". Declare it for both.
  resolve: { alias: { "@": src } },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
