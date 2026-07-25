// ---------------------------------------------------------------------------
// Dead-channel guard. Adding an IPC channel costs three edits (registry entry,
// host handler, fixture stub) and the compiler enforces all three — so a
// channel whose CALLER later disappears leaves a fully-implemented,
// fully-typechecked, permanently unreachable surface behind. Nothing in the
// gate noticed: knip sees the registry entry used by the handler map, and the
// handler used by the registry.
//
// "Supply" files are excluded from the search — the registry itself, the host
// handler registrations, and the dev-harness fixture Bridge all mention every
// method by construction. What remains is DEMAND: a renderer, mobile, a test,
// a doc, or an e2e script actually reaching for it.
//
// Deliberately conservative: it matches bare identifiers, so a channel whose
// name is also an ordinary word could be kept alive by a coincidental mention.
// It errs toward passing — a failure here is always real.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { IPC_METHODS } from "../ipc-registry";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** Files that mention every method by construction — supply, not demand. */
const SUPPLY = new Set(
  [
    "packages/bridge/src/ipc-registry.ts",
    "apps/desktop/dev/fixture-bridge.ts",
    "packages/bridge/src/__tests__/no-dead-channels.test.ts",
  ].map((rel) => path.join(REPO_ROOT, rel)),
);

const SUPPLY_DIRS = [path.join(REPO_ROOT, "packages/server/src/handlers")];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".cache",
  ".turbo",
  ".output",
  ".expo",
  "coverage",
  ".git",
]);

function sourceFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      sourceFiles(full, out);
    } else if (/\.(tsx?|mjs|md)$/.test(entry.name)) {
      if (SUPPLY.has(full)) continue;
      if (SUPPLY_DIRS.some((supplyDir) => full.startsWith(supplyDir + path.sep))) continue;
      out.push(full);
    }
  }
}

describe("no dead bridge channels", () => {
  it("every registry method has a caller outside the registry, handlers and fixture", () => {
    const files: string[] = [];
    for (const dir of ["apps", "packages", "docs", ".claude"]) {
      sourceFiles(path.join(REPO_ROOT, dir), files);
    }
    const corpus = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

    const dead = IPC_METHODS.filter((method) => !new RegExp(`\\b${method}\\b`).test(corpus));

    expect(
      dead,
      `Bridge channels nothing calls anymore — delete the registry entry, its host\n` +
        `handler and its fixture stub, or wire up the caller:\n` +
        dead.map((method) => `  ${method}`).join("\n"),
    ).toEqual([]);
  });
});
