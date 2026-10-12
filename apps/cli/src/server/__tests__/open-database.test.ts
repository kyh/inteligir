import { chmodSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeConnection, createConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { resolveMigrationsFolder } from "../../paths";
import { deviceCredentialPath } from "../cloud/credential-store";
import { openDatabase } from "../open-database";
import type { OpenDatabaseArgs } from "../open-database";
import { makeTempDir } from "./temp-dir";

const dataDirWith = (prepare: (databasePath: string) => void): OpenDatabaseArgs => {
  const dataDir = makeTempDir("inteligir-open-db-");
  const databasePath = path.join(dataDir, "inteligir.db");
  prepare(databasePath);
  writeFileSync(deviceCredentialPath(dataDir), "{}\n");
  return { dataDir, databasePath };
};

const writeUnknownHistory = (databasePath: string): void => {
  const raw = createConnection(databasePath).$client;
  raw.exec(
    `CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT);
     INSERT INTO "__drizzle_migrations" (hash, created_at, name) VALUES ('h', 1786863867000, '20260816070427_secret_polaris');
     CREATE TABLE threads (id text PRIMARY KEY, title text);
     INSERT INTO threads (id, title) VALUES ('thr_old', 'kept nowhere');`,
  );
  raw.close();
};

// the permission case needs a user the mode binds; root unlinks through a read-only folder.
const modesBind = process.platform !== "win32" && process.getuid?.() !== 0;

const silenceWarnings = () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  onTestFinished(() => {
    warn.mockRestore();
  });
  return warn;
};

const migrationsFolder = (): string => {
  const folder = resolveMigrationsFolder();
  if (folder === undefined) {
    throw new Error("no migrations folder resolves from this checkout");
  }
  return folder;
};

describe("openDatabase", () => {
  it("replaces a file migrated through generations this build does not carry, and signs out", () => {
    const warn = silenceWarnings();
    const { dataDir, databasePath } = dataDirWith(writeUnknownHistory);

    const { db, schemaVersion } = openDatabase({ databasePath, dataDir });
    onTestFinished(() => {
      closeConnection(db);
    });

    expect(schemaVersion).toBe(1);
    expect(db.$client.prepare("SELECT count(*) FROM threads").pluck().get()).toBe(0);
    expect(existsSync(deviceCredentialPath(dataDir))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/20260816070427_secret_polaris/u));
  });

  it.runIf(modesBind)(
    "signs out before it removes the file, so a replace stopped midway is redone with no sign-in left",
    () => {
      silenceWarnings();
      const dataDir = makeTempDir("inteligir-open-db-");
      const databaseDir = path.join(dataDir, "database");
      mkdirSync(databaseDir);
      const databasePath = path.join(databaseDir, "inteligir.db");
      writeUnknownHistory(databasePath);
      writeFileSync(deviceCredentialPath(dataDir), "{}\n");
      // sqlite cannot make the -wal and -shm in a read-only folder, so an open handle keeps them.
      const holder = createConnection(databasePath);
      chmodSync(databaseDir, 0o555);
      try {
        expect(() => openDatabase({ databasePath, dataDir })).toThrow(/EACCES/u);
      } finally {
        chmodSync(databaseDir, 0o755);
        closeConnection(holder);
      }
      expect(existsSync(databasePath)).toBe(true);
      expect(existsSync(deviceCredentialPath(dataDir))).toBe(false);

      const { db, schemaVersion } = openDatabase({ databasePath, dataDir });
      onTestFinished(() => {
        closeConnection(db);
      });

      expect(schemaVersion).toBe(1);
      expect(db.$client.prepare("SELECT count(*) FROM threads").pluck().get()).toBe(0);
    },
  );

  it("opens a current file as it is, signed in", () => {
    const { dataDir, databasePath } = dataDirWith((file) => {
      const db = createConnection(file);
      runMigrations(db, migrationsFolder());
      db.$client.exec(
        "INSERT INTO threads (id, status, created_at, updated_at) VALUES ('thr_kept', 'idle', 1, 1)",
      );
      closeConnection(db);
    });

    const { db } = openDatabase({ databasePath, dataDir });
    onTestFinished(() => {
      closeConnection(db);
    });

    expect(db.$client.prepare("SELECT id FROM threads").pluck().all()).toEqual(["thr_kept"]);
    expect(existsSync(deviceCredentialPath(dataDir))).toBe(true);
  });

  it("refuses a newer build's file and leaves it, and the sign-in, where they are", () => {
    const { dataDir, databasePath } = dataDirWith((file) => {
      const newer = makeTempDir("inteligir-open-db-newer-");
      cpSync(migrationsFolder(), newer, { recursive: true });
      mkdirSync(path.join(newer, "99991231235959_next"));
      writeFileSync(
        path.join(newer, "99991231235959_next", "migration.sql"),
        "UPDATE `meta` SET `value` = '99' WHERE `key` = 'schema_version';",
      );
      const db = createConnection(file);
      runMigrations(db, newer);
      closeConnection(db);
    });

    expect(() => openDatabase({ databasePath, dataDir })).toThrow(/on schema v99/u);
    expect(existsSync(databasePath)).toBe(true);
    expect(existsSync(deviceCredentialPath(dataDir))).toBe(true);
  });
});
