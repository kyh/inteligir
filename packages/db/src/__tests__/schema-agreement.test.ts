// ---------------------------------------------------------------------------
// The committed migrations against the declared schema.
//
// Unlike apps/web (which pushes and has no migration files), this database is a
// FILE on a user's machine that only migrations can move. So two artifacts have
// to agree and neither checks the other: `src/schema.ts` is what every query is
// typed against, `drizzle/*.sql` is what the file on disk actually becomes. A
// hand-edited migration, or a schema change nobody ran `db:generate` for, makes
// the app's queries describe a table that does not exist — at runtime, on a
// user's data, after the release.
//
// So: apply the committed migrations to a fresh database, apply the schema's
// own DDL (`drizzle-kit export`, which reads the schema and touches no
// database) to another, and compare what SQLite ended up with.
//
// Column ORDER is deliberately not compared. `ALTER TABLE … ADD COLUMN` appends
// where a fresh `CREATE TABLE` places the column as declared, so the two texts
// differ on a database that is otherwise identical — and no query in this repo
// is positional. Everything else in the table body is compared exactly:
// columns, types, defaults, NOT NULL, primary keys, foreign keys and CHECK
// constraints.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { createConnection } from "../connection";
import { getSchemaVersion } from "../meta";
import { runMigrations } from "../migrate";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = join(PACKAGE_ROOT, "drizzle");

/** drizzle's own bookkeeping table, and SQLite's internals. Neither is schema. */
const NOT_SCHEMA = /^(?:sqlite_|__drizzle_migrations$)/;

const scratch = mkdtempSync(join(tmpdir(), "inteligir-schema-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface SchemaObject {
  type: string;
  name: string;
  sql: string;
}

function isSchemaRow(value: unknown): value is { type: string; name: string; sql: string | null } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "sql" in value &&
    (typeof value.sql === "string" || value.sql === null)
  );
}

/** Split a `CREATE TABLE` body on its TOP-LEVEL commas: a CHECK constraint and
 *  a compound key both carry commas inside parentheses of their own. */
function topLevelMembers(body: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      members.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  members.push(current);
  return members.map((member) => member.replaceAll(/\s+/g, " ").trim()).filter(Boolean);
}

/** A table's definition with its members SORTED — see the column-order note
 *  above. Anything that is not a table (an index) keeps its text as written,
 *  because column order inside an index IS the index. */
function normalize(type: string, sql: string): string {
  const flat = sql.replaceAll(/\s+/g, " ").trim();
  if (type !== "table") return flat;
  const open = flat.indexOf("(");
  const close = flat.lastIndexOf(")");
  if (open === -1 || close <= open) return flat;
  const head = flat.slice(0, open).trim();
  const members = topLevelMembers(flat.slice(open + 1, close)).toSorted();
  return `${head} (${members.join(", ")})`;
}

/** The object list alone — asserted first, so a missing table reads as a
 *  missing table rather than as a wall of DDL diffs. */
function names(objects: SchemaObject[]): string[] {
  return objects.map((object) => `${object.type} ${object.name}`);
}

function schemaOf(databaseFile: string): SchemaObject[] {
  const raw = new Database(databaseFile, { readonly: true });
  const rows = raw.prepare("select type, name, sql from sqlite_master").all();
  raw.close();
  const objects: SchemaObject[] = [];
  for (const row of rows) {
    if (!isSchemaRow(row)) throw new Error("sqlite_master returned an unexpected row shape");
    if (NOT_SCHEMA.test(row.name) || row.sql === null) continue;
    objects.push({ type: row.type, name: row.name, sql: normalize(row.type, row.sql) });
  }
  return objects.toSorted((a, b) => `${a.type} ${a.name}`.localeCompare(`${b.type} ${b.name}`));
}

function migratedDatabase(): string {
  const file = join(scratch, "migrated.db");
  const db = createConnection(file);
  runMigrations(db);
  db.$client.close();
  return file;
}

function declaredDatabase(): string {
  // `drizzle-kit export` prints the DDL the schema declares and opens no
  // database — the same derivation apps/web's vitest config uses for its D1
  // test schema, so there is one way in this repo to ask "what does the schema
  // say" and no generated file to fall behind.
  const ddl = execFileSync(
    "pnpm",
    [
      "exec",
      "drizzle-kit",
      "export",
      "--dialect=sqlite",
      `--schema=${join(PACKAGE_ROOT, "src/schema.ts")}`,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
  const file = join(scratch, "declared.db");
  const raw = new Database(file);
  raw.exec(ddl);
  raw.close();
  return file;
}

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

function isJournal(value: unknown): value is Journal {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "idx" in entry &&
        typeof entry.idx === "number" &&
        "tag" in entry &&
        typeof entry.tag === "string",
    )
  );
}

function journal(): Journal {
  const value: unknown = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  );
  if (!isJournal(value))
    throw new Error("drizzle/meta/_journal.json: expected { entries: [{ idx, tag }] }");
  return value;
}

describe("the migrations and the declared schema agree", () => {
  it("produce the same objects", () => {
    const migrated = schemaOf(migratedDatabase());
    const declared = schemaOf(declaredDatabase());

    expect(
      names(migrated),
      "Tables/indexes the migrations create differ from the ones src/schema.ts declares.\n" +
        "Run `pnpm --filter @repo/db db:generate` and commit the migration it writes.",
    ).toEqual(names(declared));

    const differences: string[] = [];
    for (const [index, object] of migrated.entries()) {
      const other = declared[index];
      if (other === undefined || object.sql === other.sql) continue;
      differences.push(
        `SCHEMA DRIFT  ${object.type} ${object.name}\n` +
          `  rule: the committed migrations must produce exactly what src/schema.ts declares — every query in the app is typed against the schema and runs against the migrated file\n` +
          `  migrations: ${object.sql}\n` +
          `  schema.ts:  ${other.sql}\n` +
          `  fix: \`pnpm --filter @repo/db db:generate\` and commit the migration; never hand-edit one that shipped`,
      );
    }
    expect(differences, `\n${differences.join("\n\n")}\n`).toEqual([]);
  });

  it("leave meta.schema_version at the latest migration's generation", () => {
    const entries = journal().entries;
    const db = createConnection(migratedDatabase());
    const version = getSchemaVersion(db, entries.length);
    db.$client.close();

    const latest = entries.at(-1);
    if (latest === undefined) throw new Error("drizzle/meta/_journal.json has no entries");
    expect(
      version,
      `meta.schema_version is ${version} after applying ${entries.length} migrations ` +
        `(latest: ${latest.tag}).\n` +
        `  rule: each migration bumps meta.schema_version to its own generation, so /system/status proves WHICH migration the file is on\n` +
        `  fix: add \`UPDATE \\\`meta\\\` SET \\\`value\\\` = '${entries.length}' WHERE \\\`key\\\` = 'schema_version';\` to drizzle/${latest.tag}.sql`,
    ).toBe(entries.length);
  });
});
