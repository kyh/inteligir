import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
