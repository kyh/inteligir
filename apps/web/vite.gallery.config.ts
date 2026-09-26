import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("src", import.meta.url));

// the @repo/ui gallery alone, at /gallery: no Worker and no router, so it is never a route the
// deployed site answers.
export default defineConfig({
  plugins: [viteReact({ compiler: true }), tailwindcss()],
  resolve: {
    alias: { "@": src },
  },
  // beside dev:web's 5174, so both run at once; strictPort for the same reason that one pins.
  server: { port: 5175, strictPort: true },
});
