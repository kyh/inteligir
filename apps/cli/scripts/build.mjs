// Bundles the CLI entry into dist/index.js: one ESM file with every JS
// dependency inlined (the workspace packages export TS source, so a packaged
// install cannot resolve them unbundled). Same shape as the app's
// build-node-entry.mjs; no native modules, so nothing stays external.

import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

await build({
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  bundle: true,
  entryPoints: ["src/index.ts"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: "dist/index.js",
  platform: "node",
  sourcemap: true,
  target: "node24",
});
