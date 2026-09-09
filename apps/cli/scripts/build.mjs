// workspace packages export TS source, so everything JS is inlined; the native
// modules stay external as prebuilt N-API addons npm installs.

import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(packageRoot, "dist");
const repoRoot = path.resolve(packageRoot, "..", "..");

const rendererDir = path.join(repoRoot, "apps", "desktop", ".output", "app", "renderer");

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

const NATIVE = ["better-sqlite3", "@parcel/watcher", "sherpa-onnx-node"];

const shared = {
  banner: { js: NODE_ESM_REQUIRE_BANNER },
  bundle: true,
  format: "esm",
  // "linked" so the inlined MIT notices survive into a sibling .LEGAL.txt
  legalComments: "linked",
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node24",
};

await rm(distDir, { force: true, recursive: true });

await build({
  ...shared,
  entryPoints: [path.join(packageRoot, "src", "index.ts")],
  external: NATIVE,
  outfile: path.join(distDir, "index.js"),
});

// the watcher is a forked child process, so it needs its own file beside the entry
await build({
  ...shared,
  entryPoints: [
    path.join(packageRoot, "src", "server", "vault", "watcher", "parcel-child-entry.ts"),
  ],
  external: ["@parcel/watcher"],
  outfile: path.join(distDir, "parcel-watcher-child.mjs"),
});

// the transcriber is a worker thread, so it needs its own file beside the entry
await build({
  ...shared,
  entryPoints: [path.join(packageRoot, "src", "server", "voice", "transcribe-worker.ts")],
  external: ["sherpa-onnx-node"],
  outfile: path.join(distDir, "transcribe-worker.mjs"),
});

await cp(path.join(repoRoot, "packages", "db", "drizzle"), path.join(distDir, "drizzle"), {
  recursive: true,
});

await cp(path.join(repoRoot, "packages", "agent-skills", "skills"), path.join(distDir, "skills"), {
  recursive: true,
});

// licence texts live at the repo root, which no `files` glob can name
await cp(path.join(repoRoot, "tools", "licenses"), path.join(distDir, "licenses"), {
  recursive: true,
});

// refused, not skipped: a bundle without the UI boots and opens a browser on a 404
if (!existsSync(rendererDir)) {
  throw new Error(
    `the workspace UI is missing (${rendererDir}) — run \`pnpm --filter @repo/desktop build\` first`,
  );
}
await cp(rendererDir, path.join(distDir, "ui"), { recursive: true });

process.stdout.write("inteligir: bundled the server, the CLI and the workspace UI\n");
