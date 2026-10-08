// workspace packages export TS source, so everything JS is inlined; the native
// modules stay external as prebuilt N-API addons npm installs.

import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(packageRoot, "dist");
const repoRoot = path.resolve(packageRoot, "..", "..");

// the desktop app's page, which `serve` answers as the workspace UI (apps/desktop/vite.config.ts)
const rendererDir = path.join(repoRoot, "apps", "desktop", "dist", "app");

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

// left external, so the published install must carry it as a dependency of its own: the code that
// opens it is @repo/db's, inlined, and a name only that package declared would be missing from the
// install. resolving it from here fails a build whose manifest dropped it, rather than its users.
import.meta.resolve("better-sqlite3");
const NATIVE = ["better-sqlite3"];

const shared = {
  // so the metafile names every input and output from here
  absWorkingDir: packageRoot,
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

// what every client verb loads before it reads argv. the server (hono, drizzle) is `serve`'s alone,
// reached through a dynamic import; a static one slips past every test and every review, so the
// build refuses it.
const LOADED_ON_EVERY_VERB_REFUSED = [
  "node_modules/.pnpm/hono@",
  "node_modules/.pnpm/drizzle-orm@",
];
const STATIC_IMPORT_KINDS = new Set(["import-statement", "require-call"]);

const staticClosure = (metafile, entryPoint) => {
  const entry = Object.keys(metafile.outputs).find(
    (output) => metafile.outputs[output].entryPoint === entryPoint,
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

const assertEntryLoadsNone = (metafile, entryPoint, refused) => {
  const loaded = staticClosure(metafile, entryPoint);
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

const CLI_ENTRY = "src/index.ts";

// split so a client verb parses the client alone: every dynamic import is a chunk loaded on use.
// the chunks sit flat beside index.js, because `import.meta.url` and `import.meta.dirname` in any
// of them must name dist/ (src/paths.ts). the desktop
// shell's own door (src/desktop/desktop-entry.ts) is a second entry over the same chunks, so the
// server it runs is the one `inteligir serve` runs, loaded once.
const { metafile } = await build({
  ...shared,
  chunkNames: "chunk-[hash]",
  entryNames: "[name]",
  entryPoints: { desktop: "src/desktop/desktop-entry.ts", index: CLI_ENTRY },
  external: NATIVE,
  metafile: true,
  outdir: distDir,
  splitting: true,
});
assertEntryLoadsNone(metafile, CLI_ENTRY, LOADED_ON_EVERY_VERB_REFUSED);

await cp(path.join(repoRoot, "packages", "db", "drizzle"), path.join(distDir, "drizzle"), {
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

process.stdout.write(
  "inteligir: bundled the server, the CLI, the desktop shell's door and the workspace UI\n",
);
