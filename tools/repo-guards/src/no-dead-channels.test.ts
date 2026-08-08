// ---------------------------------------------------------------------------
// Dead-channel guard. Adding an IPC channel costs three edits (registry entry,
// host handler, fixture stub) and the compiler enforces all three — so a
// channel whose CALLER later disappears leaves a fully-implemented,
// fully-typechecked, permanently unreachable surface behind. Nothing else in
// the gate notices: knip sees the registry entry used by the handler map, and
// the handler used by the registry.
//
// "Supply" files are excluded from the search — the registry itself, the host
// handler registrations, and the fixture Bridge all mention every method by
// construction. What remains is DEMAND: a client, a test, or a doc actually
// reaching for it.
//
// Deliberately conservative: it matches bare identifiers, so a channel whose
// name is also an ordinary word could be kept alive by a coincidental mention.
// It errs toward passing — a failure here is always real.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { IPC_METHODS } from "@repo/bridge/ipc-registry";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Files that mention every method by construction — supply, not demand.
 * The blueprints are here because they quote real channels as WORKED EXAMPLES
 * of the mechanism, never as callers: a channel named only by a blueprint is
 * dead, and counting the mention as demand would prop it up forever.
 *
 * The agent grant table is here for the sharpest version of the same reason: it
 * partitions the WHOLE non-event registry by construction (agent-grant-parity
 * enforces exactly that), and most of what it names, it names in order to DENY
 * — the opposite of a consumer. Left in the corpus it would keep nearly every
 * channel in the registry looking alive. */
const SUPPLY = new Set(
  [
    "packages/bridge/src/ipc-registry.ts",
    "packages/bridge/src/channel-policy.ts",
    "packages/bridge/src/agent-grants.ts",
    "packages/workspace/src/dev/fixture-bridge.ts",
    "tools/repo-guards/src/no-dead-channels.test.ts",
    ".claude/skills/add-bridge-channel/SKILL.md",
    ".claude/skills/add-editor-node/SKILL.md",
  ].map((rel) => path.join(REPO_ROOT, rel)),
);

/** The host's handler registrations. They are spread across the worker's
 * feature folders rather than gathered under one, so the exclusion is by NAME:
 * a file that registers handlers mentions its methods by construction. */
const SUPPLY_FILE = /(?:[a-z-]*handlers|handler-registry)\.ts$/;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".cache",
  ".turbo",
  ".output",
  ".expo",
  ".wrangler",
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
      if (SUPPLY_FILE.test(entry.name)) continue;
      out.push(full);
    }
  }
}

describe("no dead bridge channels", () => {
  it("every registry method has a caller outside the registry, handlers and fixture", () => {
    const files: string[] = [];
    for (const dir of ["apps", "packages", "tools", "docs", ".claude"]) {
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
