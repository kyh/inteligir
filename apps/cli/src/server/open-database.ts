import { rmSync } from "node:fs";
import { closeConnection, createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations, UnknownMigrationHistoryError } from "@repo/db/migrate";
import { resolveMigrationsFolder } from "../paths";

export interface OpenedDatabase {
  db: DbConnection;
  schemaVersion: number;
}

export interface OpenDatabaseArgs {
  databasePath: string;
}

const SQLITE_SIDECARS = ["", "-wal", "-shm"] as const;

const openMigrated = (databasePath: string): OpenedDatabase => {
  const db = createConnection(databasePath);
  try {
    return {
      db,
      schemaVersion: getSchemaVersion(db, runMigrations(db, resolveMigrationsFolder())),
    };
  } catch (error) {
    closeConnection(db);
    throw error;
  }
};

// a file migrated through generations this build does not carry cannot be upgraded in place, so
// it is replaced with a fresh one, and the threads it held go with it: they live on this Mac alone.
// the sign-in stays, since nothing in the file is the account's. a newer build's file is never
// replaced: getSchemaVersion refuses it.
export const openDatabase = (args: OpenDatabaseArgs): OpenedDatabase => {
  try {
    return openMigrated(args.databasePath);
  } catch (error) {
    if (!(error instanceof UnknownMigrationHistoryError)) {
      throw error;
    }
    for (const suffix of SQLITE_SIDECARS) {
      rmSync(`${args.databasePath}${suffix}`, { force: true });
    }
    console.warn(
      `[db] ${args.databasePath} was migrated through ${error.unknown.join(", ")}, which this ` +
        `build does not carry: replaced it with a fresh database`,
    );
  }
  return openMigrated(args.databasePath);
};
