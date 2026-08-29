// The repo root's own `scripts/` tree — dev commands that belong to no
// workspace, and therefore to none of a workspace's own gates.
//
// Two directions, because the two failures are independent and neither is
// visible anywhere else. A file no manifest row runs is a command with no
// name: knip cannot see it, since the entry glob that stops knip reporting the
// tree as unused makes every file in it an entry by construction. A row naming
// a file that is not there is the worse half — a command a developer or an
// agent reads out of the manifest and runs, failing at the moment they trust
// it. `dangling-references.test.ts` answers that second shape for every path
// under a workspace GROUP, and `scripts/` is not one, so it is answered here.
//
// The limit, stated: with an empty tree the first assertion has nothing to
// judge and passes. Deleting the last script is a real decision, so it is not
// made into a failure.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REPO_ROOT } from "./repo";

const ROOT_MANIFEST = "package.json";
const SCRIPTS_DIR = "scripts";

/** A path into the tree, wherever a script row names one. */
const SCRIPT_REFERENCE = /(scripts\/[A-Za-z0-9._-]+)/g;

const scriptTableSchema = z.looseObject({ scripts: z.record(z.string(), z.string()) });

function rootScripts(): Record<string, string> {
  const file = path.join(REPO_ROOT, ROOT_MANIFEST);
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const parsed = scriptTableSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${ROOT_MANIFEST}: expected a "scripts" table of strings`);
  }
  return parsed.data.scripts;
}

/** The tree's own contents, from the directory rather than a list. */
function scriptFiles(): string[] {
  const dir = path.join(REPO_ROOT, SCRIPTS_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => `${SCRIPTS_DIR}/${entry}`)
    .toSorted();
}

describe("the root scripts/ tree", () => {
  it("every script file is run by a root package.json script", () => {
    const commands = Object.values(rootScripts());
    const violations = scriptFiles()
      .filter((file) => !commands.some((command) => command.includes(file)))
      .map(
        (file) =>
          `UNREACHABLE  ${file}\n` +
          `  rule: a script at the repo root is reached through a "scripts" row in ${ROOT_MANIFEST} — nothing else names it, so a file without one is a command nobody can run\n` +
          `  fix: add the row, or delete the file with the command it outlived`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every scripts/ path a root script names is a file that exists", () => {
    const violations: string[] = [];
    for (const [name, command] of Object.entries(rootScripts())) {
      for (const reference of command.matchAll(SCRIPT_REFERENCE)) {
        const referenced = reference[1] ?? "";
        if (fs.existsSync(path.join(REPO_ROOT, referenced))) {
          continue;
        }
        violations.push(
          `MISSING  ${name}\n` +
            `  runs: ${command}\n` +
            `  rule: "${referenced}" is not on disk, so this row fails the moment somebody trusts the name\n` +
            `  fix: repoint the row at the file that runs, or drop it`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
