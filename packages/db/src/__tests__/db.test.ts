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

/**
 * A copy of the shipped migrations folder cut off after `generations` — an
 * OLDER build of this package, as far as `runMigrations` can tell.
 */
function freezeMigrationsAt(dir: string, generations: number): void {
  cpSync(fileURLToPath(new URL("../../drizzle", import.meta.url)), dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("drizzle/meta/_journal.json is not an object");
  }
  const journal: Record<string, unknown> = { ...parsed };
  const entries = journal["entries"];
  if (!Array.isArray(entries)) {
    throw new Error("drizzle/meta/_journal.json has no entries array");
  }
  journal["entries"] = entries.filter((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("a journal entry is not an object");
    }
    const idx = Reflect.get(entry, "idx");
    const tag = Reflect.get(entry, "tag");
    if (typeof idx !== "number" || typeof tag !== "string") {
      throw new Error("a journal entry is missing idx/tag");
    }
    if (idx >= generations) {
      unlinkSync(join(dir, `${tag}.sql`));
      return false;
    }
    return true;
  });
  writeFileSync(journalPath, JSON.stringify(journal));
}

describe("boot", () => {
  it("migrates on boot and bumps meta.schema_version to the latest generation", () => {
    const db = openTempDb();
    expect(getSchemaVersion(db, runMigrations(db))).toBe(4);
    expect(getMetaValue(db, "schema_version")).toBe("4");
  });

  it("is idempotent across boots", () => {
    const db = openTempDb();
    runMigrations(db);
    expect(getSchemaVersion(db, runMigrations(db))).toBe(4);
  });

  it("upgrades a POPULATED v2 database in place: child rows survive, FKs hold", () => {
    const v2Migrations = mkdtempSync(join(tmpdir(), "inteligir-db-migrations-v2-"));
    tempDirs.push(v2Migrations);
    freezeMigrationsAt(v2Migrations, 2);

    const db = openTempDb();
    expect(getSchemaVersion(db, runMigrations(db, v2Migrations))).toBe(2);

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

    expect(getSchemaVersion(db, runMigrations(db))).toBe(4);

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
    expect(() => getSchemaVersion(db, 4)).toThrow();
  });

  it("refuses a database a NEWER build already upgraded", () => {
    // The v2 folder is a stand-in for an older build: it applies nothing to a
    // v4 file (drizzle skips migrations older than the last applied one), so
    // without a ceiling the boot would carry on reading a schema it has no
    // SQL for — silently, until a query hit a column that moved.
    const db = openTempDb();
    runMigrations(db);

    const older = mkdtempSync(join(tmpdir(), "inteligir-db-migrations-old-"));
    tempDirs.push(older);
    freezeMigrationsAt(older, 2);

    const known = runMigrations(db, older);
    expect(known).toBe(2);
    expect(() => getSchemaVersion(db, known)).toThrow(
      /on schema v4, but this build only knows v2/u,
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
