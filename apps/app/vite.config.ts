import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // SPA mode: no runtime SSR — the build prerenders `/_shell.html` and the
    // Node entry (src/node/main.ts) rewrites HTML navigations to it.
    // `installDevServerMiddleware` is what makes `viteDevServer.middlewares`
    // serve the whole Start app under middlewareMode; without the flag the
    // plugin deliberately skips installing its middleware there.
    tanstackStart({
      spa: { enabled: true },
      vite: { installDevServerMiddleware: true },
    }),
    viteReact(),
    tailwindcss(),
  ],
});
