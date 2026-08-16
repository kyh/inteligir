import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Database-level facts, one row per key. `schema_version` is seeded by the
 * first migration and bumped by later ones, so it always states which
 * migration generation the file is on.
 */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
