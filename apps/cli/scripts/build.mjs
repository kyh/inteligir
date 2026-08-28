// The published artifact: one ESM bundle plus the files this program READS
// rather than imports.
//
// Everything JS is inlined — the workspace packages export TS source, so a
// packaged install cannot resolve them unbundled — and the three NATIVE
// modules stay external, because they arrive as prebuilt N-API addons that
// npm installs and no bundler can swallow.
//
// Two of those bundles cannot ride inside the entry, and each says why beside
// itself: the vault watcher is a forked CHILD PROCESS and the transcriber is a
// WORKER THREAD, so both need a real file on disk, resolved as a sibling of
// the running entry.
//
// The staged trees are content, not code: the committed migrations
// (@repo/db/migrate resolves a folder), the dialect skills the agent reads with
// its own shell, the workspace UI this server answers over plain HTTP so
// `inteligir serve --open` lands a browser in the product, and the licence
// texts of the MIT sources this artifact carries.

import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");
const repoRoot = resolve(packageRoot, "..", "..");

/** The desktop renderer's build. It is the SAME bundle the shell serves over
 *  its own protocol; staging it here is what makes the zero-install path a
 *  verb rather than a second package. */
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
  // "linked", never "none": every inlined dependency is MIT-or-similar, so a
  // marked notice has to survive the bundle rather than be stripped out of it.
  // It lands in a sibling `.LEGAL.txt`, which `files: ["dist"]` already ships.
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

// The watcher child is its own process, so its entry cannot ride inside the
// bundle: the fork channel resolves it as a SIBLING of the running entry.
await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "server", "vault", "watcher", "parcel-child-entry.ts")],
  external: ["@parcel/watcher"],
  outfile: join(distDir, "parcel-watcher-child.mjs"),
});

// The transcription worker is its own thread with its own module graph, so
// like the watcher child it cannot ride inside the entry.
await build({
  ...shared,
  entryPoints: [join(packageRoot, "src", "server", "voice", "transcribe-worker.ts")],
  external: ["sherpa-onnx-node"],
  outfile: join(distDir, "transcribe-worker.mjs"),
});

await cp(join(repoRoot, "packages", "db", "drizzle"), join(distDir, "drizzle"), {
  recursive: true,
});

// The dialect skills are FILES the agent opens with its own shell, so they are
// staged rather than imported — a published install resolves no workspace
// package (paths.ts::resolveSkillsDir).
await cp(join(repoRoot, "packages", "agent-skills", "skills"), join(distDir, "skills"), {
  recursive: true,
});

// The vendored sources' licence texts. They live at the repo root, which no
// `files` glob can name, so the obligation is met by staging them INTO dist —
// the same move the skills and the UI make, for a different reason.
await cp(join(repoRoot, "tools", "licenses"), join(distDir, "licenses"), {
  recursive: true,
});

// REFUSED rather than skipped: a bundle that shipped without the UI would boot,
// answer the API, and open a browser on a 404 — a failure with no error
// anywhere. The renderer is `@repo/desktop#build`'s output, which this task
// declares as its dependency.
if (!existsSync(rendererDir)) {
  throw new Error(
    `the workspace UI is missing (${rendererDir}) — run \`pnpm --filter @repo/desktop build\` first`,
  );
}
await cp(rendererDir, join(distDir, "ui"), { recursive: true });

process.stdout.write("inteligir: bundled the server, the CLI and the workspace UI\n");
