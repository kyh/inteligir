import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // BUILD ONLY, and the asymmetry is the point. The Start server entry is
  // loaded by the shipping process (src/node/main.ts imports
  // dist/server/server.js as the prod fallback), which ships as a bundle with
  // only its two native modules external — so an SSR build that left `react`
  // as a bare import works in a checkout and fails a packaged install with
  // ERR_MODULE_NOT_FOUND. Inlining makes the artifact's dependency list a fact
  // about this repo rather than about what vite chose to externalize.
  //
  // Dev must keep the default. Vite's module runner evaluates an inlined
  // dependency as ESM, and react's entry is CommonJS: `noExternal` there makes
  // every SSR render throw `module is not defined`.
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
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
}));
