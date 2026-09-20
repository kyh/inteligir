// drizzle-kit 1.0 plans `.unique()` as a table recreate, and D1 ignores `PRAGMA foreign_keys=OFF`,
// so the recreate's DROP cascades through every ON DELETE CASCADE child. `push` applies it unasked.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf, workspaces } from "./repo";

const DRIZZLE_CONFIG = "drizzle.config.ts";
const D1_DRIVER = /\bdriver:\s*"d1-http"/u;
const SCHEMA_PATH = /\bschema:\s*"(?<schema>[^"]+)"/u;
const UNIQUE_MODIFIER = /\.unique\(/u;

// the schema a d1-http drizzle config pushes, so a second D1 workspace is swept the day it lands.
const d1SchemaFiles = (): string[] => {
  const files: string[] = [];
  for (const workspace of workspaces()) {
    const config = path.posix.join(workspace.dir, DRIZZLE_CONFIG);
    if (!fs.existsSync(path.join(REPO_ROOT, config))) {
      continue;
    }
    const source = sourceOf(config);
    if (!D1_DRIVER.test(source)) {
      continue;
    }
    const schema = SCHEMA_PATH.exec(source)?.groups?.schema;
    if (schema === undefined) {
      throw new Error(`${config}: a d1-http config with no string "schema" to sweep`);
    }
    files.push(path.posix.join(workspace.dir, schema));
  }
  return files.toSorted();
};

describe("D1 unique constraints", () => {
  it("are named unique indexes, never the `.unique()` column modifier", () => {
    const files = d1SchemaFiles();
    if (files.length === 0) {
      throw new Error(`no ${DRIZZLE_CONFIG} declares d1-http — the sweep is broken, not the tree`);
    }

    const violations: string[] = [];
    for (const file of files) {
      const lines = sourceOf(file).split("\n");
      for (const line of lines) {
        if (UNIQUE_MODIFIER.test(line)) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(
      violations,
      `a D1 schema declares a unique with the \`.unique()\` column modifier:\n  ${violations.join("\n  ")}\n` +
        `  rule: drizzle-kit 1.0 turns \`.unique()\` into a table recreate, and on D1 the recreate's DROP cascade-wipes every child table (CLAUDE.md, "Declare D1 uniques as named unique indexes, never \`.unique()\`")\n` +
        `  fix: drop the modifier and add uniqueIndex("<table>_<column>_unique").on(table.<column>) to the table's extra config`,
    ).toEqual([]);
  });
});
