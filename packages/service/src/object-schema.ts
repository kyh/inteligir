// A Durable Object's SQLite schema brought to this build's once per wake, inside
// `blockConcurrencyWhile`, with synchronous SQL only
// (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/):
// the account's cell and each note's object alike. drizzle-kit owns the DDL. There are no users,
// so an object this build cannot migrate is wiped and migrated from empty: one holding tables
// drizzle did not make, or one that applied a migration this build's journal lacks (a regenerated
// baseline, a rollback). A known migration the object skipped is no wipe, since the migrator runs
// whatever an object lacks by name.

import { TransactionRollbackError } from "drizzle-orm";
import type { AnyRelations } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import { errorFields } from "./log";

const MIGRATIONS_TABLE = "__drizzle_migrations";

// what the object holds: nothing, tables drizzle did not make, or the migrations it applied
type SchemaVerdict =
  | { readonly kind: "empty" }
  | { readonly kind: "foreign" }
  | { readonly kind: "drizzle"; readonly applied: readonly string[] };

// the runtime's own tables (`_cf_KV` and its kin) and SQLite's are no schema's
const tableNames = (storage: DurableObjectStorage): string[] =>
  storage.sql
    .exec<{ name: string }>(
      String.raw`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE '\_cf\_%' ESCAPE '\' AND name NOT LIKE 'sqlite\_%' ESCAPE '\'`,
    )
    .toArray()
    .map((row) => row.name);

const verdictOf = (storage: DurableObjectStorage): SchemaVerdict => {
  const tables = tableNames(storage);
  if (tables.length === 0) {
    return { kind: "empty" };
  }
  if (!tables.includes(MIGRATIONS_TABLE)) {
    return { kind: "foreign" };
  }
  const applied = storage.sql
    .exec<{ name: string | null }>(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`)
    .toArray()
    .map((row) => row.name ?? "");
  return { applied, kind: "drizzle" };
};

export interface ObjectSchema<TRelations extends AnyRelations> {
  readonly db: DrizzleSqliteDODatabase<TRelations>;
  readonly journal: { readonly migrations: Record<string, string> };
  // the object's kind as the log names it
  readonly what: string;
}

// A throw leaves the object as it was, since the migrator runs every pending migration in one
// transaction. A failed run names the migrations the object had not applied: the migrator rolls
// back with a bare "Rollback" and drops the failing statement's own error.
export const migrateObjectSchema = async <TRelations extends AnyRelations>(
  storage: DurableObjectStorage,
  schema: ObjectSchema<TRelations>,
): Promise<void> => {
  const known = Object.keys(schema.journal.migrations).toSorted();
  let verdict = verdictOf(storage);
  if (
    verdict.kind === "foreign" ||
    (verdict.kind === "drizzle" && verdict.applied.some((name) => !known.includes(name)))
  ) {
    // the most an object ever deletes, so the log says what it found
    console.warn({ event: `${schema.what}-schema-reset`, found: verdict });
    await storage.deleteAll();
    verdict = { kind: "empty" };
  }
  try {
    migrate(schema.db, { migrations: schema.journal.migrations });
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      const applied = verdict.kind === "drizzle" ? verdict.applied : [];
      const pending = known.filter((name) => !applied.includes(name));
      console.error({ event: `${schema.what}-migration-failed`, pending });
      throw new Error(`the ${schema.what}'s migrations did not run: ${pending.join(", ")}`, {
        cause: error,
      });
    }
    throw error;
  }
};

// The schema migrated as the object wakes: the runtime holds every event until it settles, and a
// throw resets the object, whose next event opens it again. The one place an object of this Worker
// blocks its own events, so the account's cell never awaits a note under it (`oxlint.config.ts`).
export const openWithSchema = (
  ctx: DurableObjectState,
  what: string,
  migrateSchema: (storage: DurableObjectStorage) => Promise<void>,
): void => {
  void ctx.blockConcurrencyWhile(async () => {
    try {
      await migrateSchema(ctx.storage);
    } catch (error) {
      console.error({ event: `${what}-open-failed`, ...errorFields(error) });
      throw error;
    }
  });
};
