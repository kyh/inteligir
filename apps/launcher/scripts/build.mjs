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

import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  APP_BUNDLE_DIR,
  APP_CLIENT_DIR,
  APP_DIR,
  CLI_BIN_DIR,
  CLI_BIN_NAME,
  CLI_DIR,
  cliBin,
  cliBinDir,
  distDir as installDistDir,
  launcherEntry,
  appSkillsDir,
  stagedAppDir,
  stagedCliDir,
} from "./staged-layout.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const distDir = installDistDir(packageRoot);
const appSource = resolve(packageRoot, "..", APP_DIR);
const cliSource = resolve(packageRoot, "..", CLI_DIR);
const stagedApp = stagedAppDir(packageRoot);
const stagedCli = stagedCliDir(packageRoot);

const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (!version) {
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
  outfile: launcherEntry(packageRoot),
  platform: "node",
  sourcemap: true,
  target: "node24",
});
await chmod(launcherEntry(packageRoot), 0o755);

// The app: the Node bundle (with its forked watcher child and the migrations
// copied beside it) plus the built SPA the prod fallback serves.
await cp(join(appSource, APP_BUNDLE_DIR), join(stagedApp, APP_BUNDLE_DIR), { recursive: true });
await cp(join(appSource, APP_CLIENT_DIR), join(stagedApp, APP_CLIENT_DIR), { recursive: true });
await writeFile(
  join(stagedApp, "package.json"),
  `${JSON.stringify({ name: "inteligir-app", private: true, type: "module", version }, null, 2)}\n`,
);

// The dialect skills (@repo/agent-skills): CONTENT the agent reads with its
// shell, staged beside the app bundle so the packaged layout's fallback probe
// (resolveSkillsDir walks dist-node/../skills) finds them — the workspace
// package cannot be a published dependency.
await cp(
  join(packageRoot, "..", "..", "packages", "agent-skills", "skills"),
  appSkillsDir(packageRoot),
  { recursive: true },
);

// The virgin-boot vault seed (apps/app/seed): CONTENT the vault copies on
// first run, staged beside the app bundle so resolveSeedDir's packaged probe
// (dist-node/../seed) finds it — same shelf, same reason as the skills.
await cp(join(packageRoot, "..", "app", "seed"), join(stagedApp, "seed"), { recursive: true });

// Third-party license texts. This is the ONLY published workspace — every
// other package is `private: true` — so the notices MIT and Apache require to
// travel with a copy have to travel with THIS artifact, not with a package
// nobody installs. Centralized under tools/licenses and collected from there.
const stagedLicenses = join(distDir, "licenses");
await mkdir(stagedLicenses, { recursive: true });
for (const name of await readdir(join(repoRoot, "tools", "licenses"))) {
  await cp(join(repoRoot, "tools", "licenses", name), join(stagedLicenses, name));
}
await cp(join(repoRoot, "LICENSE"), join(stagedLicenses, "LICENSE.inteligir"));

// The CLI: its own bundle plus the `inteligir` shim two different callers
// resolve — npm's `inteligir-cli` bin, and the PATH entry the server injects
// into agent shells.
//
// GENERATED rather than copied, and it is a NODE script rather than the
// checkout's `#!/bin/sh` one. The checkout shim exists to prefer `../src`
// under tsx, which a package has neither of; and a `sh` shebang is what npm
// reads to build its Windows `.cmd`, so shipping it makes `inteligir-cli`
// unresolvable there. A node shebang works on every platform npm supports and
// still satisfies the agent's PATH resolver, which wants a file named
// `inteligir` with the execute bit.
//
// The generated package.json is what makes the extensionless file ESM (Node
// resolves a bare entry's module type from the nearest `type` field) and what
// `--version` reads; without it the CLI degrades to its "0.0.0" placeholder.
await mkdir(cliBinDir(packageRoot), { recursive: true });
await writeFile(cliBin(packageRoot), '#!/usr/bin/env node\nimport "../dist/index.js";\n');
await chmod(cliBin(packageRoot), 0o755);
await cp(join(cliSource, "dist"), join(stagedCli, "dist"), { recursive: true });
await writeFile(
  join(stagedCli, "package.json"),
  `${JSON.stringify({ name: "inteligir-cli", private: true, type: "module", version }, null, 2)}\n`,
);

process.stdout.write(
  `${CLI_BIN_NAME} ${version}: staged ${relative(packageRoot, stagedApp)} + ${relative(packageRoot, stagedCli)}, cli bin ${CLI_BIN_DIR}/${CLI_BIN_NAME}\n`,
);
