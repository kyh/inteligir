// `drizzle/*.sql` is what a user's file becomes and `src/schema.ts` is what every query is typed
// against; neither checks the other. column order is not compared: `ALTER TABLE … ADD COLUMN`
// appends where a fresh `CREATE TABLE` places the column as declared, and no query is positional.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { createConnection } from "../connection";
import { asMapping, isText, type JsonValue } from "../json-source";
import { parseMigrationJournal, type MigrationJournal } from "../migration-journal";
import { getSchemaVersion } from "../meta";
import { runMigrations } from "../migrate";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = join(PACKAGE_ROOT, "drizzle");

// drizzle's bookkeeping table and sqlite's internals.
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

// `sql` is null for the objects sqlite creates for itself (auto-indexes).
interface SchemaRow {
  type: string;
  name: string;
  sql: string | null;
}

function parseSchemaRow(row: JsonValue): SchemaRow | null {
  const fields = asMapping(row);
  const type = fields?.["type"];
  const name = fields?.["name"];
  const sql = fields?.["sql"];
  if (!isText(type) || !isText(name)) return null;
  if (sql === null) return { type, name, sql: null };
  return isText(sql) ? { type, name, sql } : null;
}

// a CHECK constraint or a compound key carries commas inside its own parentheses.
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

// only a table's members are sorted: column order inside an index is the index.
function normalize(type: string, sql: string): string {
  // sqlite's own RENAME (the tail of a table-rebuild migration) rewrites the stored CREATE with
  // double-quoted names where drizzle writes backticks.
  const flat = sql
    .replaceAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g, "`$1`")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (type !== "table") return flat;
  const open = flat.indexOf("(");
  const close = flat.lastIndexOf(")");
  if (open === -1 || close <= open) return flat;
  const head = flat.slice(0, open).trim();
  const members = topLevelMembers(flat.slice(open + 1, close)).toSorted();
  return `${head} (${members.join(", ")})`;
}

function names(objects: SchemaObject[]): string[] {
  return objects.map((object) => `${object.type} ${object.name}`);
}

function schemaOf(databaseFile: string): SchemaObject[] {
  const raw = new Database(databaseFile, { readonly: true });
  const rows = raw.prepare<[], JsonValue>("select type, name, sql from sqlite_master").all();
  raw.close();
  const objects: SchemaObject[] = [];
  for (const rawRow of rows) {
    const row = parseSchemaRow(rawRow);
    if (!row) throw new Error("sqlite_master returned an unexpected row shape");
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
  // `drizzle-kit export` prints the schema's ddl and opens no database.
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

function journal(): MigrationJournal {
  const journalPath = join(MIGRATIONS_DIR, "meta/_journal.json");
  return parseMigrationJournal(readFileSync(journalPath, "utf8"), journalPath);
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
    // spawns drizzle-kit: ~0.5s idle, but it timed out at vitest's 5s on a busy ci runner.
  }, 30_000);

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
