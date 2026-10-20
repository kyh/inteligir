import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closeConnection, createConnection } from "./connection";
import type { DbConnection } from "./connection";
import { createPrefixedId, GENERATED_ID_SUFFIX_LENGTH } from "./ids";
import { getMetaValue, getSchemaVersion } from "./meta";
import { listMigrationNames, runMigrations, UnknownMigrationHistoryError } from "./migrate";
import { noopNotifier } from "@repo/domain/notifier";
import { makeTempDir } from "./test-support/open-temp-db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

// derived from the folder: a hand-typed number turns every new migration into a test edit.
const latestGeneration = (): number => {
  const count = listMigrationNames(MIGRATIONS_DIR).length;
  if (count === 0) {
    throw new Error(`${MIGRATIONS_DIR} has no migration folders`);
  }
  return count;
};

const LATEST = latestGeneration();

// the baseline every build before the library's applied, which no build carries now
const RETIRED_BASELINE = "20261017051242_baseline";

// un-migrated, unlike the shared fixture: the migrator is what these suites test.
const openTempDb = (): DbConnection =>
  createConnection(path.join(makeTempDir("inteligir-db-test-"), "test.db"));

// what a newer build's copy is: this build's folders and one generation after them.
const newerMigrations = (): string => {
  const dir = makeTempDir("inteligir-db-migrations-newer-");
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const next = path.join(dir, "99991231235959_next");
  mkdirSync(next);
  writeFileSync(
    path.join(next, "migration.sql"),
    `UPDATE \`meta\` SET \`value\` = '${LATEST + 1}' WHERE \`key\` = 'schema_version';`,
  );
  return dir;
};

const tableNames = (db: DbConnection): unknown[] =>
  db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();

describe("boot", () => {
  it("migrates on boot and bumps meta.schema_version to the latest generation", () => {
    const db = openTempDb();
    expect(getSchemaVersion(db, runMigrations(db))).toBe(LATEST);
    expect(getMetaValue(db, "schema_version")).toBe(String(LATEST));
  });

  it("is idempotent across boots", () => {
    const db = openTempDb();
    runMigrations(db);
    expect(getSchemaVersion(db, runMigrations(db))).toBe(LATEST);
  });

  it("refuses to answer a schema version before migrations ran", () => {
    const db = openTempDb();
    expect(() => getSchemaVersion(db, LATEST)).toThrow();
  });

  it("refuses a database a NEWER build already upgraded", () => {
    // its ledger names a generation after this build's newest, so the migrator applies nothing
    // and the ceiling is the only guard.
    const db = openTempDb();
    expect(runMigrations(db, newerMigrations())).toBe(LATEST + 1);

    const known = runMigrations(db);
    expect(known).toBe(LATEST);
    expect(() => getSchemaVersion(db, known)).toThrow(
      new RegExp(`on schema v${LATEST + 1}, but this build only knows v${LATEST}`, "u"),
    );
  });

  it("refuses a file migrated through generations this build does not carry, and asks for a wipe", () => {
    const db = openTempDb();
    db.$client.exec(
      `CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT);
       INSERT INTO "__drizzle_migrations" (hash, created_at, name) VALUES ('h', 1786863867000, '20260816070427_secret_polaris');
       CREATE TABLE threads (id text PRIMARY KEY);`,
    );

    expect(() => runMigrations(db)).toThrow(UnknownMigrationHistoryError);
    expect(() => runMigrations(db)).toThrow(
      /20260816070427_secret_polaris, which this build does not carry.*wipe it .*and restart/u,
    );
    // refused before the migrator ran: the baseline was not laid over the file's own tables.
    expect(tableNames(db)).toEqual(["__drizzle_migrations", "threads"]);
  });

  it("refuses a file on the retired baseline, whose folder name this build does not carry", () => {
    // the one baseline is regenerated under a new folder name, never in place: drizzle keys its
    // ledger by the name, so a file a build before it migrated must read as a history this build lacks
    const retired = makeTempDir("inteligir-db-migrations-retired-");
    const [current] = listMigrationNames(MIGRATIONS_DIR);
    if (current === undefined) {
      throw new Error(`${MIGRATIONS_DIR} has no migration folders`);
    }
    cpSync(path.join(MIGRATIONS_DIR, current), path.join(retired, RETIRED_BASELINE), {
      recursive: true,
    });
    const db = openTempDb();
    runMigrations(db, retired);

    expect(() => runMigrations(db)).toThrow(UnknownMigrationHistoryError);
    expect(() => runMigrations(db)).toThrow(
      new RegExp(`${RETIRED_BASELINE}, which this build does not carry`, "u"),
    );
  });

  it("refuses a ledger whose rows name no migration at all", () => {
    const db = openTempDb();
    db.$client.exec(
      `CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
       INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('h', 1786863867225);`,
    );
    expect(() => runMigrations(db)).toThrow(
      /through \(unnamed\), which this build does not carry/u,
    );
  });

  it("opens with WAL and synchronous=NORMAL", () => {
    const db = openTempDb();
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    // synchronous=NORMAL reads back as 1.
    expect(db.$client.pragma("synchronous", { simple: true })).toBe(1);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("hands a deleted row's pages back to the disk on close", () => {
    const databasePath = path.join(makeTempDir("inteligir-db-test-"), "test.db");
    const db = createConnection(databasePath);
    runMigrations(db);
    db.$client.exec("CREATE TABLE scratch (body TEXT NOT NULL)");
    const insert = db.$client.prepare("INSERT INTO scratch (body) VALUES (?)");
    for (let row = 0; row < 500; row += 1) {
      insert.run("x".repeat(1000));
    }
    db.$client.exec("DELETE FROM scratch");
    expect(db.$client.pragma("freelist_count", { simple: true })).toBeGreaterThan(100);

    closeConnection(db);
    // a second close is the teardown running after a test closed it itself.
    closeConnection(db);

    const reopened = createConnection(databasePath);
    expect(reopened.$client.pragma("freelist_count", { simple: true })).toBe(0);
    closeConnection(reopened);
  });
});

describe("the paired columns", () => {
  const halves = [
    ["a session without its harness", "UPDATE threads SET provider_thread_id = 'p'"],
    ["a note id without its path", "UPDATE threads SET origin_note_id = 'n'"],
    ["a claim time without its token", "UPDATE queued_thread_messages SET claimed_at = 1"],
    [
      "an answered approval without its decision",
      "UPDATE pending_interactions SET status = 'resolved'",
    ],
    ["a decision on an approval still open", "UPDATE pending_interactions SET decision = 'deny'"],
  ] as const;

  it.each(halves)("refuses %s", (_, statement) => {
    const db = openTempDb();
    runMigrations(db);
    db.$client.exec(
      `INSERT INTO threads (id, status, created_at, updated_at) VALUES ('thr_1', 'idle', 1, 1);
       INSERT INTO events (id, thread_id, scope_kind, sequence, type, created_at)
         VALUES ('evt_1', 'thr_1', 'thread', 1, 'client/turn/requested', 1);
       INSERT INTO queued_thread_messages (id, thread_id, sort_key, text, created_at, updated_at)
         VALUES ('qmsg_1', 'thr_1', 'a', 'queued', 1, 1);
       INSERT INTO pending_interactions
         (id, thread_id, request_key, status, payload, created_at, updated_at)
         VALUES ('pint_1', 'thr_1', 'req_1', 'pending', '{}', 1, 1);`,
    );
    expect(() => db.$client.exec(statement)).toThrow(/CHECK constraint failed/u);
  });
});

describe("ids", () => {
  it("creates prefixed ids from the reduced alphabet", () => {
    const id = createPrefixedId("thr");
    expect(id).toMatch(
      new RegExp(`^thr_[23456789abcdefghijkmnpqrstuvwxyz]{${GENERATED_ID_SUFFIX_LENGTH}}$`, "u"),
    );
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(createPrefixedId("evt"));
    }
    expect(seen.size).toBe(1000);
  });
});

describe("noopNotifier", () => {
  it("swallows every notification", () => {
    expect(() => {
      noopNotifier.notifyVault(["files-changed"]);
      noopNotifier.notifyDoc("doc-1", ["content-changed"]);
      noopNotifier.notifyThread("thr_1", ["events-appended"]);
    }).not.toThrow();
  });
});
