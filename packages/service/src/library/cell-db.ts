// The cell's SQLite through drizzle, over the tables `@repo/db/cell/schema` declares, and its
// schema brought to this build's once per wake inside `blockConcurrencyWhile`, with synchronous SQL
// only (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
// drizzle-kit owns the DDL. There are no users, so a cell this build cannot migrate is wiped and
// migrated from empty: one holding tables drizzle did not make, or one that applied a migration
// this build's journal lacks (a regenerated baseline, a rollback). A known migration the cell
// skipped is no wipe, since the migrator runs whatever a cell lacks by name.

import { defineRelations, getColumns, sql, TransactionRollbackError } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import journal from "@repo/db/cell/migrations";
import * as cellSchema from "@repo/db/cell/schema";
import { SQL_MAX_PARAMS } from "./library-sql";

// drizzle 1.0 registers a table only through `relations`, which also holds every table drizzle-kit
// alone reads to a use
const relations = defineRelations(cellSchema);

export type CellDb = DrizzleSqliteDODatabase<typeof relations>;

// holds only the storage, so a wipe leaves it whole
export const cellDbOf = (storage: DurableObjectStorage): CellDb => drizzle(storage, { relations });

const MIGRATIONS_TABLE = "__drizzle_migrations";

const JOURNAL: readonly string[] = Object.keys(journal.migrations).toSorted();

// what the cell holds: nothing, tables drizzle did not make, or the migrations it applied
type CellVerdict =
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

const verdictOf = (storage: DurableObjectStorage): CellVerdict => {
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

const startsOver = (verdict: CellVerdict): boolean =>
  verdict.kind === "foreign" ||
  (verdict.kind === "drizzle" && verdict.applied.some((name) => !JOURNAL.includes(name)));

// the migrations a cell has not applied, which a failed run names: the migrator rolls back with a
// bare "Rollback" and drops the failing statement's own error
const pendingOf = (verdict: CellVerdict): string[] =>
  verdict.kind === "drizzle"
    ? JOURNAL.filter((name) => !verdict.applied.includes(name))
    : [...JOURNAL];

// a throw leaves the cell as it was, since the migrator runs every pending migration in one
// transaction
export const migrateCell = async (storage: DurableObjectStorage): Promise<void> => {
  let verdict = verdictOf(storage);
  if (startsOver(verdict)) {
    // the most a cell ever deletes, so the log says what it found
    console.warn({ event: "cell-schema-reset", found: verdict });
    await storage.deleteAll();
    verdict = { kind: "empty" };
  }
  try {
    migrate(cellDbOf(storage), journal);
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      const pending = pendingOf(verdict);
      console.error({ event: "cell-migration-failed", pending });
      throw new Error(`the cell's migrations did not run: ${pending.join(", ")}`, { cause: error });
    }
    throw error;
  }
};

// the row an upsert offered, for its SET, which sqlite-core spells by hand
export const excluded = (column: SQLiteColumn): SQL => sql`excluded.${sql.identifier(column.name)}`;

// A SQLite Durable Object binds at most 100 parameters to one statement, so a statement carrying
// many rows or a long IN list is cut into several
// (https://developers.cloudflare.com/durable-objects/platform/limits/).
const chunksOf = <T>(values: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
};

// a multi-row insert's rows, cut by the table's width: drizzle binds a value for every column it
// writes, and an explicit null is one, so a row is held to bind them all
export const insertChunks = <T>(table: SQLiteTable, rows: readonly T[]): T[][] =>
  chunksOf(rows, Math.floor(SQL_MAX_PARAMS / Object.keys(getColumns(table)).length));

// an IN list's values, cut so each statement binds them beside `bound` parameters of its own
export const listChunks = <T>(values: readonly T[], bound = 0): T[][] =>
  chunksOf(values, SQL_MAX_PARAMS - bound);
