// The CLI the .app ships, as a folder of its own that `bundle.resources` maps to
// Contents/Resources/server: the package as npm would publish it (its `files`), and its production
// dependencies installed from the lockfile, hoisted so no symlink rides into the bundle.
// `pnpm deploy` does exactly that; npm itself would ignore the lockfile. Run after
// `inteligir#build`.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const STAGED_SERVER_DIR = path.join(packageRoot, ".output", "server");

// what pnpm writes beside the package for a later install, and the links its bins get; nothing at
// runtime reads either, and a link in Resources is one more thing the signature has to explain
const PRUNED = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "node_modules/.pnpm", "node_modules/.bin"];

const log = (line) => {
  process.stdout.write(`stage-server: ${line}\n`);
};

if (!existsSync(path.join(repoRoot, "apps", "cli", "dist", "desktop.js"))) {
  throw new Error("the CLI is not built: run `pnpm turbo run build --filter=inteligir` first");
}
await rm(STAGED_SERVER_DIR, { force: true, recursive: true });
const deployed = spawnSync(
  "pnpm",
  ["--filter", "inteligir", "deploy", "--prod", "--config.node-linker=hoisted", STAGED_SERVER_DIR],
  { cwd: repoRoot, stdio: "inherit" },
);
if (deployed.status !== 0) {
  throw new Error(`pnpm deploy exited ${deployed.status ?? deployed.signal}`);
}
for (const entry of PRUNED) {
  await rm(path.join(STAGED_SERVER_DIR, entry), { force: true, recursive: true });
}
// the package's own `files`, and its dependencies: nothing else may reach the bundle
const kept = new Set(["README.md", "bin", "dist", "node_modules", "package.json"]);
const staged = await readdir(STAGED_SERVER_DIR);
const stray = staged.filter((name) => !kept.has(name));
if (stray.length > 0) {
  throw new Error(`the staged CLI holds what its \`files\` never named: ${stray.join(", ")}`);
}
log(`the CLI and its production dependencies -> ${path.relative(packageRoot, STAGED_SERVER_DIR)}`);
