// One bundle: the Electron main process. There is no preload and no renderer
// of ours — the window loads the local server and everything it renders is
// served from there.
//
// CJS, and the `.cjs` EXTENSION is load-bearing: this package is
// `"type": "module"`, so a `.js` main would be parsed as ESM and the bundle's
// `require`s would throw before the app drew anything.

import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");

await rm(distDir, { recursive: true, force: true });

await build({
  bundle: true,
  entryPoints: [join(packageRoot, "src", "main", "index.ts")],
  // `electron` is the runtime's own module, never bundled.
  external: ["electron"],
  format: "cjs",
  legalComments: "none",
  logLevel: "info",
  outfile: join(distDir, "main.cjs"),
  platform: "node",
  sourcemap: true,
  target: "node24",
});

process.stdout.write("@repo/desktop: built the main process\n");
