import { eq } from "drizzle-orm";
import type { DbConnection } from "./connection";
import { meta } from "./schema";

export function getMetaValue(db: DbConnection, key: string): string | undefined {
  const row = db.select().from(meta).where(eq(meta.key, key)).get();
  return row?.value;
}

/** The `meta.schema_version` row — seeded by the first migration. */
export function getSchemaVersion(db: DbConnection): number {
  const value = getMetaValue(db, "schema_version");
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("meta.schema_version is missing or invalid — did migrations run?");
  }
  return parsed;
}
