import { cp, lstat, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const src = fileURLToPath(new URL("src", import.meta.url));

// the library's page, `@repo/workspace`'s build, which turbo builds first (`^build`): its files go
// into the site's own assets under LIBRARY_PAGE_PATH, where the Worker answers the page's document
// for every path under it (src/worker/library/library-page.ts)
const LIBRARY_PAGE_BUILD = fileURLToPath(new URL("../workspace/dist", import.meta.url));
const LIBRARY_PAGE_DIR = "library";

const libraryPage = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === "client",
  name: "inteligir:library-page",
  writeBundle: async (options) => {
    if (options.dir === undefined) {
      throw new Error("the site's client build names no output directory");
    }
    await cp(LIBRARY_PAGE_BUILD, path.join(options.dir, LIBRARY_PAGE_DIR), { recursive: true });
  },
});

// under `vite dev` the assets binding reads the public directory, so the page's build is linked
// into it (and git ignores the link): the Worker answers /library through the same route as
// deployed, over the build `pnpm dev:web` keeps current (apps/workspace's `dev`)
const libraryPageInDev = (): Plugin => ({
  apply: "serve",
  configureServer: async () => {
    const link = fileURLToPath(new URL(`public/${LIBRARY_PAGE_DIR}`, import.meta.url));
    const held = await lstat(link).catch(() => null);
    if (held === null) {
      await symlink(LIBRARY_PAGE_BUILD, link, "dir");
    }
  },
  name: "inteligir:library-page-dev",
});

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      experimental: { newConfig: { cfBuildOutput: true } },
    }),
    // the entry lives in src/worker because that directory is its own tsconfig program and the
    // entry names Env.
    tanstackStart({ server: { entry: "./worker/server.ts" } }),
    // compiler: true is the only consumer of the oxc-transform-react devDependency.
    viteReact({ compiler: true }),
    tailwindcss(),
    libraryPage(),
    libraryPageInDev(),
  ],
  // the dev SSR runner does not read tsconfig paths, unlike vite build.
  resolve: {
    alias: { "@": src },
  },
  // strictPort: every doc and script names :5174, so failing to bind beats moving.
  server: { port: 5174, strictPort: true },
  // `cf deploy` uploads whatever source maps the build emits
  environments: { ssr: { build: { sourcemap: true } } },
});
