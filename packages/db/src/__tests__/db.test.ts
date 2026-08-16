import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import { createPrefixedId, GENERATED_ID_SUFFIX_LENGTH } from "../ids";
import { getMetaValue, getSchemaVersion } from "../meta";
import { runMigrations } from "../migrate";
import { noopNotifier } from "../notifier";

const tempDirs: string[] = [];

function openTempDb(): DbConnection {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-db-test-"));
  tempDirs.push(dir);
  return createConnection(join(dir, "test.db"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("boot", () => {
  it("migrates on boot and bumps meta.schema_version to the latest generation", () => {
    const db = openTempDb();
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(3);
    expect(getMetaValue(db, "schema_version")).toBe("3");
  });

  it("is idempotent across boots", () => {
    const db = openTempDb();
    runMigrations(db);
    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(3);
  });

  it("upgrades a POPULATED v2 database in place: child rows survive, FKs hold", () => {
    // A migrations folder frozen at generation 2 (the shipped 0000+0001).
    const sourceMigrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
    const v2Migrations = mkdtempSync(join(tmpdir(), "inteligir-db-migrations-v2-"));
    tempDirs.push(v2Migrations);
    cpSync(sourceMigrations, v2Migrations, { recursive: true });
    const journalPath = join(v2Migrations, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    for (const entry of journal.entries) {
      if (entry.idx >= 2) {
        unlinkSync(join(v2Migrations, `${entry.tag}.sql`));
      }
    }
    journal.entries = journal.entries.filter((entry) => entry.idx < 2);
    writeFileSync(journalPath, JSON.stringify(journal));

    const db = openTempDb();
    runMigrations(db, v2Migrations);
    expect(getSchemaVersion(db)).toBe(2);

    // Populate a thread with rows in every child table.
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

    runMigrations(db);
    expect(getSchemaVersion(db)).toBe(3);

    // Every child row survived the upgrade and still resolves its parent.
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
    // Pre-migration the meta table itself is missing, so sqlite refuses.
    expect(() => getSchemaVersion(db)).toThrow();
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
      noopNotifier.notifySystem(["config-changed"]);
      noopNotifier.notifyVault(["files-changed"]);
      noopNotifier.notifyDoc("doc-1", ["content-changed"]);
      noopNotifier.notifyThread("thr_1", ["events-appended"]);
    }).not.toThrow();
  });
});
