import { eq } from "drizzle-orm";
import type { DbConnection } from "./connection";
import { meta } from "./schema";

export function getMetaValue(db: DbConnection, key: string): string | undefined {
  const row = db.select().from(meta).where(eq(meta.key, key)).get();
  return row?.value;
}

/**
 * The `meta.schema_version` row — seeded by the first migration, bumped by
 * every one after it.
 *
 * `latestKnownVersion` is what `runMigrations` returned, and passing it is not
 * optional: a database written by a NEWER build migrates to a generation this
 * build has no SQL for, so `migrate` applies nothing and every read afterwards
 * is made against a schema this code does not know — silently, until a query
 * hits a column that moved. Both ends of the range are refused here, at the
 * one place the version is read.
 */
export function getSchemaVersion(db: DbConnection, latestKnownVersion: number): number {
  const value = getMetaValue(db, "schema_version");
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("meta.schema_version is missing or invalid — did migrations run?");
  }
  if (parsed > latestKnownVersion) {
    throw new Error(
      `This database is on schema v${parsed}, but this build only knows v${latestKnownVersion}. ` +
        `A newer version of inteligir has already upgraded it — update inteligir, or point ` +
        `INTELIGIR_DATA_DIR at a different data directory.`,
    );
  }
  return parsed;
}
