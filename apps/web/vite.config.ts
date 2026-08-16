import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
const workspaceSrc = fileURLToPath(new URL("../../packages/workspace/src", import.meta.url));
const editorSrc = fileURLToPath(new URL("../../packages/editor/src", import.meta.url));

export default defineConfig({
  // Pin the dev port, and REFUSE to drift off it. strictPort matters more than
  // the number: the ticket mint's Origin allowlist is exact, so a silent bump
  // to 5175 mints nothing and produces a workspace that renders but cannot
  // reach its own host. Failing to bind is the loud version of that.
  server: { port: 5174, strictPort: true },
  // `@/*` is declared in tsconfig paths only. `vite build` resolves it (the
  // start plugin reads tsconfig), but the dev SSR runner does not — `vite dev`
  // 500'd with "Cannot find module '@/lib/site-config'". Declare it for both.
  //
  // The two UI packages are aliased to their SOURCE. Their exports maps spell
  // the extension fallback as an ARRAY
  // (`"./*": ["./src/*.tsx", "./src/*.ts"]`), which the client environment's
  // resolver walks and the workerd environment's does not — so a `.ts` module
  // under either package resolves in one build and fails the other. Pointing
  // both at the directory makes it ordinary extension resolution in every
  // environment.
  resolve: {
    alias: { "@": src, "@repo/workspace": workspaceSrc, "@repo/editor": editorSrc },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // Start would otherwise take `src/server.ts` as the server entry. The entry
    // lives with the rest of the Worker instead, because that directory is its
    // own tsconfig program (see src/worker/tsconfig.json) — and the entry, which
    // names `Env` and re-exports the Durable Object, has to be inside it.
    tanstackStart({ server: { entry: "./worker/server.ts" } }),
    viteReact(),
    tailwindcss(),
  ],
});
