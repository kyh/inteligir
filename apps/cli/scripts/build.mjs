// workspace packages export TS source, so everything JS is inlined; the native
// modules stay external as prebuilt N-API addons npm installs.

import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");
const repoRoot = resolve(packageRoot, "..", "..");

const rendererDir = join(repoRoot, "apps", "desktop", ".output", "app", "renderer");

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

await rm(distDir, { recursive: true, force: true });

await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "index.ts")],
  external: NATIVE,
  outfile: join(distDir, "index.js"),
});

// the watcher is a forked child process, so it needs its own file beside the entry
await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "server", "vault", "watcher", "parcel-child-entry.ts")],
  external: ["@parcel/watcher"],
  outfile: join(distDir, "parcel-watcher-child.mjs"),
});

// the transcriber is a worker thread, so it needs its own file beside the entry
await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "server", "voice", "transcribe-worker.ts")],
  external: ["sherpa-onnx-node"],
  outfile: join(distDir, "transcribe-worker.mjs"),
});

await cp(join(repoRoot, "packages", "db", "drizzle"), join(distDir, "drizzle"), {
  recursive: true,
});

await cp(join(repoRoot, "packages", "agent-skills", "skills"), join(distDir, "skills"), {
  recursive: true,
});

// licence texts live at the repo root, which no `files` glob can name
await cp(join(repoRoot, "tools", "licenses"), join(distDir, "licenses"), {
  recursive: true,
});

// refused, not skipped: a bundle without the UI boots and opens a browser on a 404
if (!existsSync(rendererDir)) {
  throw new Error(
    `the workspace UI is missing (${rendererDir}) — run \`pnpm --filter @repo/desktop build\` first`,
  );
}
await cp(rendererDir, join(distDir, "ui"), { recursive: true });

process.stdout.write("inteligir: bundled the server, the CLI and the workspace UI\n");
