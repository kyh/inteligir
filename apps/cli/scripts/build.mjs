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

// what every client verb loads before it reads argv. yaml is 72 modules the few verbs that read
// frontmatter need, so they reach it through a dynamic import; a static one slips past every test
// and every review, so the build refuses it.
const LOADED_ON_EVERY_VERB_REFUSED = ["node_modules/.pnpm/yaml@"];
const STATIC_IMPORT_KINDS = new Set(["import-statement", "require-call"]);

const staticClosure = (metafile) => {
  const entry = Object.keys(metafile.outputs).find(
    (output) => metafile.outputs[output].entryPoint !== undefined,
  );
  const reached = new Set();
  const pending = entry === undefined ? [] : [entry];
  for (let output = pending.pop(); output !== undefined; output = pending.pop()) {
    if (reached.has(output)) {
      continue;
    }
    reached.add(output);
    for (const imported of metafile.outputs[output].imports) {
      if (STATIC_IMPORT_KINDS.has(imported.kind) && imported.external !== true) {
        pending.push(imported.path);
      }
    }
  }
  return new Set([...reached].flatMap((output) => Object.keys(metafile.outputs[output].inputs)));
};

const assertEntryLoadsNone = (metafile, refused) => {
  const loaded = staticClosure(metafile);
  for (const marker of refused) {
    const importers = [...loaded].filter(
      (input) =>
        !input.includes(marker) &&
        metafile.inputs[input]?.imports.some(
          (imported) => STATIC_IMPORT_KINDS.has(imported.kind) && imported.path.includes(marker),
        ),
    );
    if (importers.length > 0) {
      throw new Error(
        `every CLI verb would load ${marker}… before reading argv, statically imported by ` +
          `${importers.join(", ")}: import it with \`await import()\` in the verb that needs it`,
      );
    }
  }
};

// split so a client verb parses the client alone: every dynamic import is a chunk loaded on use.
// the chunks sit flat beside index.js, because `import.meta.url` and `import.meta.dirname` in any
// of them must name dist/ (src/paths.ts, and the sibling lookups of the bundles below).
const { metafile } = await build({
  ...shared,
  chunkNames: "chunk-[hash]",
  entryNames: "[name]",
  entryPoints: [path.join(packageRoot, "src", "index.ts")],
  external: NATIVE,
  metafile: true,
  outdir: distDir,
  splitting: true,
});
assertEntryLoadsNone(metafile, LOADED_ON_EVERY_VERB_REFUSED);

// each runs outside the entry's process or thread, so each needs its own file beside it.
const SIBLING_BUNDLES = [
  // a child process, forked by node or by the desktop shell's main
  {
    entry: path.join(packageRoot, "src", "server", "vault", "watcher", "parcel-child-entry.ts"),
    external: ["@parcel/watcher"],
    outfile: "parcel-watcher-child.mjs",
  },
  // the host the desktop shell runs each ACP adapter under, in a utility process of its own
  // (src/server/child-host/node-children.ts)
  {
    entry: path.join(packageRoot, "src", "server", "child-host", "stdio-port-host-entry.ts"),
    external: [],
    outfile: "stdio-port-host.mjs",
  },
  // the transcriber, a worker thread (src/server/worker-entry.ts)
  {
    entry: path.join(packageRoot, "src", "server", "voice", "transcribe-worker.ts"),
    external: ["sherpa-onnx-node"],
    outfile: "transcribe-worker.mjs",
  },
  // the projector, a worker thread (src/server/worker-entry.ts)
  {
    entry: path.join(packageRoot, "src", "server", "knowledge", "projection-worker.ts"),
    external: [],
    outfile: "projection-worker.mjs",
  },
];

for (const { entry, external, outfile } of SIBLING_BUNDLES) {
  await build({
    ...shared,
    entryPoints: [entry],
    external,
    outfile: path.join(distDir, outfile),
  });
}

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
