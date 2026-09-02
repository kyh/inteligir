import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // strictPort: every doc and script names :5174, so failing to bind beats moving.
  server: { port: 5174, strictPort: true },
  // the dev SSR runner does not read tsconfig paths, unlike vite build.
  resolve: {
    alias: { "@": src },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // the entry lives in src/worker because that directory is its own tsconfig program and the
    // entry names Env.
    tanstackStart({ server: { entry: "./worker/server.ts" } }),
    // compiler: true is the only consumer of the oxc-transform-react devDependency.
    viteReact({ compiler: true }),
    tailwindcss(),
  ],
});
