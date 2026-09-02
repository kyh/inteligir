import { cpSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import { createPrefixedId, GENERATED_ID_SUFFIX_LENGTH } from "../ids";
import { getMetaValue, getSchemaVersion } from "../meta";
import { runMigrations } from "../migrate";
import { parseMigrationJournal } from "../migration-journal";
import { noopNotifier } from "@repo/domain/notifier";
import { makeTempDir } from "./open-temp-db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

// derived from the journal: a hand-typed number turns every new migration into a test edit.
function latestGeneration(): number {
  const journalPath = join(MIGRATIONS_DIR, "meta/_journal.json");
  const journal = parseMigrationJournal(readFileSync(journalPath, "utf8"), journalPath);
  if (journal.entries.length === 0) {
    throw new Error(`${journalPath} has no entries`);
  }
  return journal.entries.length;
}

const LATEST = latestGeneration();

// un-migrated, unlike the shared fixture: the migrator is what these suites test.
function openTempDb(): DbConnection {
  return createConnection(join(makeTempDir("inteligir-db-test-"), "test.db"));
}

function freezeMigrationsAt(dir: string, generations: number): void {
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = parseMigrationJournal(readFileSync(journalPath, "utf8"), journalPath);
  const kept = journal.entries.filter((entry) => {
    if (entry.idx >= generations) {
      unlinkSync(join(dir, `${entry.tag}.sql`));
      return false;
    }
    return true;
  });
  journal.document["entries"] = kept.map((entry) => entry.source);
  writeFileSync(journalPath, JSON.stringify(journal.document));
}

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

  it("upgrades a POPULATED v2 database in place: child rows survive, FKs hold", () => {
    const v2Migrations = makeTempDir("inteligir-db-migrations-v2-");
    freezeMigrationsAt(v2Migrations, 2);

    const db = openTempDb();
    expect(getSchemaVersion(db, runMigrations(db, v2Migrations))).toBe(2);

    const now = Date.now();
    db.run(
      sql`INSERT INTO threads (id, status, created_at, updated_at) VALUES ('thr_v2', 'idle', ${now}, ${now})`,
    );
    db.run(
      sql`INSERT INTO events (id, thread_id, scope_kind, turn_id, sequence, type, data, created_at)
          VALUES ('evt_v2', 'thr_v2', 'thread', NULL, 1, 'client/turn/requested', '{}', ${now})`,
    );
    db.run(
      sql`INSERT INTO pending_interactions (id, thread_id, request_key, status, payload, created_at, updated_at)
          VALUES ('pint_v2', 'thr_v2', 'req-1', 'pending', '{}', ${now}, ${now})`,
    );
    db.run(
      sql`INSERT INTO queued_thread_messages (id, thread_id, text, sort_key, created_at, updated_at)
          VALUES ('qmsg_v2', 'thr_v2', 'queued', 'a', ${now}, ${now})`,
    );

    expect(getSchemaVersion(db, runMigrations(db))).toBe(LATEST);

    expect(db.get(sql`SELECT count(*) AS n FROM events WHERE thread_id = 'thr_v2'`)).toEqual({
      n: 1,
    });
    expect(
      db.get(sql`SELECT count(*) AS n FROM pending_interactions WHERE thread_id = 'thr_v2'`),
    ).toEqual({ n: 1 });
    expect(
      db.get(sql`SELECT count(*) AS n FROM queued_thread_messages WHERE thread_id = 'thr_v2'`),
    ).toEqual({ n: 1 });
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(
      db.get(
        sql`SELECT provider_id AS a, provider_thread_id AS b FROM threads WHERE id = 'thr_v2'`,
      ),
    ).toEqual({ a: null, b: null });
  });

  it("refuses to answer a schema version before migrations ran", () => {
    const db = openTempDb();
    expect(() => getSchemaVersion(db, LATEST)).toThrow();
  });

  it("refuses a database a NEWER build already upgraded", () => {
    // drizzle applies nothing from the v2 folder to a fully-migrated file, so the ceiling is
    // the only guard.
    const db = openTempDb();
    runMigrations(db);

    const older = makeTempDir("inteligir-db-migrations-old-");
    freezeMigrationsAt(older, 2);

    const known = runMigrations(db, older);
    expect(known).toBe(2);
    expect(() => getSchemaVersion(db, known)).toThrow(
      new RegExp(`on schema v${LATEST}, but this build only knows v2`, "u"),
    );
  });

  it("opens with WAL and synchronous=NORMAL", () => {
    const db = openTempDb();
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    // synchronous=NORMAL reads back as 1.
    expect(db.$client.pragma("synchronous", { simple: true })).toBe(1);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("ids", () => {
  it("creates prefixed ids from the reduced alphabet", () => {
    const id = createPrefixedId("thr");
    expect(id).toMatch(
      new RegExp(`^thr_[23456789abcdefghijkmnpqrstuvwxyz]{${GENERATED_ID_SUFFIX_LENGTH}}$`),
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
