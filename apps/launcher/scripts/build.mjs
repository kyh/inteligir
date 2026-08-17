// Assembles the PUBLISHED tree under dist/. npm packs only what lives inside
// the package directory, so the two things this package ships around — the app
// bundle and the CLI — are copied in here rather than referenced across the
// workspace.
//
// THE COPIED LAYOUT IS LOAD-BEARING, and it mirrors the repo's own `apps/`
// directory for one reason: both of the app's runtime resolvers walk relative
// to the running bundle and already expect that shape. `resolveEntryLayout`
// (apps/app/src/node/main.ts) treats the FIRST ancestor holding a package.json
// as the app directory, and `resolveCliBinDir`
// (apps/app/src/node/agent/agent-shell-env.ts) reaches the CLI as
// `dist-node/../../cli/bin`. Staging to `dist/apps/{app,cli}` satisfies both
// with no third code path to keep in step — and flattening it would break them
// silently: the app would look for its SPA beside the launcher, and the agent
// would lose the ability to drive the product with no error anywhere.
//
// `dist/apps/app/package.json` is GENERATED rather than copied: the app entry
// reads its version from it, and a packaged install should report the
// published version rather than the workspace's.
//
// The two sources are read from the workspace by PATH rather than declared as
// dependencies, because there is no import to declare — an edge with no
// importer is what tools/repo-guards/src/dep-dag.test.ts refuses. The build
// ORDER that leaves is turbo.json's business.

import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");
const appSource = resolve(packageRoot, "..", "app");
const cliSource = resolve(packageRoot, "..", "cli");
const stagedApp = join(distDir, "apps", "app");
const stagedCli = join(distDir, "apps", "cli");

const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (typeof version !== "string" || version.length === 0) {
  throw new Error("apps/launcher/package.json must declare a version");
}

await rm(distDir, { recursive: true, force: true });

await build({
  // No shebang here: esbuild hoists the entry's own, and a second one is a
  // syntax error on line 2.
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  bundle: true,
  entryPoints: [join(packageRoot, "src", "main.ts")],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: join(distDir, "inteligir.mjs"),
  platform: "node",
  sourcemap: true,
  target: "node24",
});
await chmod(join(distDir, "inteligir.mjs"), 0o755);

// The app: the Node bundle (with its forked watcher child and the migrations
// copied beside it) plus the built SPA the prod fallback serves.
await cp(join(appSource, "dist-node"), join(stagedApp, "dist-node"), { recursive: true });
await cp(join(appSource, "dist"), join(stagedApp, "dist"), { recursive: true });
await writeFile(
  join(stagedApp, "package.json"),
  `${JSON.stringify({ name: "inteligir-app", private: true, type: "module", version }, null, 2)}\n`,
);

// The CLI: its own bundle plus the bin shim the agent's PATH points at. The
// shim prefers a `../src` checkout and falls through to `../dist/index.js`,
// which is the branch a packaged install takes. Its package.json is generated
// for the same reason the app's is — `inteligir-cli --version` reads it, and a
// missing one degrades to the "0.0.0" placeholder rather than failing.
await mkdir(join(stagedCli, "bin"), { recursive: true });
await cp(join(cliSource, "bin", "inteligir"), join(stagedCli, "bin", "inteligir"));
await chmod(join(stagedCli, "bin", "inteligir"), 0o755);
await cp(join(cliSource, "dist"), join(stagedCli, "dist"), { recursive: true });
await writeFile(
  join(stagedCli, "package.json"),
  `${JSON.stringify({ name: "inteligir-cli", private: true, type: "module", version }, null, 2)}\n`,
);

process.stdout.write(`inteligir ${version}: staged dist/apps/{app,cli}\n`);
