// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// Bundles the Node entry (src/node/main.ts) into dist-node/main.js: one ESM
// file with every JS dependency inlined, native modules external, and the
// committed SQL migrations copied beside it (see @repo/db/migrate's folder
// resolution). `vite` stays external: only the dev branch imports it.

import { cp, rm } from "node:fs/promises";
import { build } from "esbuild";

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

await rm("dist-node", { recursive: true, force: true });

await build({
  banner: { js: NODE_ESM_REQUIRE_BANNER },
  bundle: true,
  entryPoints: ["src/node/main.ts"],
  external: ["better-sqlite3", "@parcel/watcher", "sherpa-onnx-node", "vite"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: "dist-node/main.js",
  platform: "node",
  sourcemap: true,
  target: "node24",
});

// The watcher child is its own process, so its entry cannot ride inside
// main.js: fork-channel resolves this bundle as a SIBLING of the running
// entry (dist-node/parcel-watcher-child.mjs).
await build({
  banner: { js: NODE_ESM_REQUIRE_BANNER },
  bundle: true,
  entryPoints: ["src/node/vault/watcher/parcel-child-entry.ts"],
  external: ["@parcel/watcher"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: "dist-node/parcel-watcher-child.mjs",
  platform: "node",
  sourcemap: true,
  target: "node24",
});

// The transcription worker is its own thread with its own module graph, so
// like the watcher child it cannot ride inside main.js: `voice-worker-host.ts`
// resolves this bundle as a SIBLING of the running entry
// (dist-node/transcribe-worker.mjs).
await build({
  banner: { js: NODE_ESM_REQUIRE_BANNER },
  bundle: true,
  entryPoints: ["src/node/voice/transcribe-worker.ts"],
  external: ["sherpa-onnx-node"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: "dist-node/transcribe-worker.mjs",
  platform: "node",
  sourcemap: true,
  target: "node24",
});

await cp("../../packages/db/drizzle", "dist-node/drizzle", { recursive: true });
