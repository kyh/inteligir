// the shipped app's safety net: every desktop install before drizzle 1.0 carries a
// `__drizzle_migrations(id, hash, created_at)` written by the old migrator, and the new one keys
// the applied set on a `name` column that table does not have. The migrator backfills it by
// matching each row's created_at (floored to the second) to a folder's timestamp, and throws on
// a row it cannot place — so this suite writes exactly what the old migrator wrote and boots.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createConnection } from "../connection";
import { getMetaValue, getSchemaVersion } from "../meta";
import { listMigrationNames, runMigrations } from "../migrate";
import { makeTempDir } from "./open-temp-db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

// the `tag` and `when` of each entry in the old `drizzle/meta/_journal.json`, in order, as it
// stood before `drizzle-kit up` converted the folder (git: packages/db/drizzle/meta/_journal.json
// at 71b8b15). The old migrator stored exactly `when` as the row's created_at, and the folder
// `drizzle-kit up` minted is `when` floored to the second plus the tag's own name — the match
// the backfill relies on. Frozen on purpose: the journal is gone and these installs are shipped.
const LEGACY_JOURNAL = [
  { tag: "0000_secret_polaris", when: 1_786_863_867_225 },
  { tag: "0001_early_tana_nile", when: 1_786_869_808_165 },
  { tag: "0002_shiny_morg", when: 1_786_893_371_175 },
  { tag: "0003_secret_lila_cheney", when: 1_786_940_194_022 },
  { tag: "0004_powerful_surge", when: 1_786_973_808_016 },
  { tag: "0005_windy_wasp", when: 1_787_025_141_393 },
  { tag: "0006_gorgeous_nova", when: 1_787_065_414_680 },
  { tag: "0007_noisy_victor_mancha", when: 1_787_374_498_965 },
  { tag: "0008_repair_schema_version", when: 1_787_378_400_000 },
  { tag: "0009_volatile_captain_america", when: 1_787_892_001_004 },
];

interface MigrationsRow {
  name: string | null;
  created_at: number;
}

const isMigrationsRow = (row: unknown): row is MigrationsRow =>
  row instanceof Object && "name" in row && "created_at" in row;

// what drizzle-orm 0.45's better-sqlite3 migrator did on a fresh file: the table with the
// pre-1.0 shape (`SERIAL` is no rowid alias, so the ids it left behind are NULL), each file's
// statements split on the breakpoint, and one row per file carrying the sha256 of the whole
// file and the journal's `when`.
const applyLegacyMigrations = (databasePath: string, names: readonly string[]): void => {
  const db = createConnection(databasePath);
  const raw = db.$client;
  raw.pragma("foreign_keys = OFF");
  raw.exec(
    `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  const insert = raw.prepare(
    `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`,
  );
  for (const [index, name] of names.entries()) {
    const query = readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf-8");
    for (const statement of query.split("--> statement-breakpoint")) {
      raw.exec(statement);
    }
    insert.run(createHash("sha256").update(query).digest("hex"), LEGACY_JOURNAL[index]?.when);
  }
  raw.pragma("foreign_keys = ON");
  raw.close();
};

describe("a database the pre-1.0 migrator wrote", () => {
  it("boots: the migrations table gains name/applied_at, every row is named, nothing re-runs", () => {
    const names = listMigrationNames(MIGRATIONS_DIR);
    // the legacy rows are the ten shipped generations; anything after them is a migration this
    // boot applies the ordinary way.
    const legacy = names.slice(0, LEGACY_JOURNAL.length);
    expect(legacy.length).toBe(LEGACY_JOURNAL.length);
    // `0003_secret_lila_cheney` became `20260817041634_secret_lila_cheney`: the folder keeps the
    // journal's name behind its own timestamp.
    expect(legacy.map((name) => name.slice(15))).toEqual(
      LEGACY_JOURNAL.map((entry) => entry.tag.slice(5)),
    );

    const databasePath = path.join(makeTempDir("inteligir-db-legacy-"), "legacy.db");
    applyLegacyMigrations(databasePath, legacy);

    const db = createConnection(databasePath);
    expect(db.all(sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`)).toEqual([
      { name: "id" },
      { name: "hash" },
      { name: "created_at" },
    ]);

    const known = runMigrations(db);
    expect(known).toBe(names.length);
    expect(getSchemaVersion(db, known)).toBe(names.length);
    expect(getMetaValue(db, "schema_version")).toBe(String(names.length));

    expect(db.all(sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`)).toEqual([
      { name: "id" },
      { name: "hash" },
      { name: "created_at" },
      { name: "name" },
      { name: "applied_at" },
    ]);

    const rows = db
      .all(sql`SELECT name, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC`)
      .filter(isMigrationsRow);
    // one row per generation and no more: a re-applied migration would have inserted another.
    expect(rows.length).toBe(names.length);
    expect(rows.slice(0, legacy.length).map((row) => row.name)).toEqual(legacy);
    expect(rows.slice(0, legacy.length).map((row) => row.created_at)).toEqual(
      LEGACY_JOURNAL.map((entry) => entry.when),
    );
    expect(rows.slice(legacy.length).map((row) => row.name)).toEqual(names.slice(legacy.length));

    // and the upgraded file is an ordinary one from here: a second boot applies nothing.
    expect(runMigrations(db)).toBe(names.length);
    expect(db.get(sql`SELECT count(*) AS n FROM "__drizzle_migrations"`)).toEqual({
      n: names.length,
    });
    db.$client.close();
  });
});
