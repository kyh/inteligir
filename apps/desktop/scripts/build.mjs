// One bundle: the Electron main process. There is no preload and no renderer
// of ours — the window loads the local server and everything it renders is
// served from there.
//
// CJS, and the `.cjs` EXTENSION is load-bearing: this package is
// `"type": "module"`, so a `.js` main would be parsed as ESM and the bundle's
// `require`s would throw before the app drew anything.

import { cp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");

await rm(distDir, { recursive: true, force: true });

const shared = {
  bundle: true,
  // `electron` is the runtime's own module, never bundled.
  external: ["electron"],
  format: "cjs",
  legalComments: "none",
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node24",
};

await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "main", "index.ts")],
  outfile: join(distDir, "main.cjs"),
});

// The browser window's chrome: its preload (the one preload in the process)
// and the bundled bar page it serves, both resolved at runtime relative to
// main.cjs (browser-window.ts).
await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "main", "browser-preload.ts")],
  outfile: join(distDir, "browser-preload.cjs"),
});
await cp(
  join(packageRoot, "src", "main", "browser-chrome.html"),
  join(distDir, "browser-chrome.html"),
);

process.stdout.write("@repo/desktop: built the main process\n");
