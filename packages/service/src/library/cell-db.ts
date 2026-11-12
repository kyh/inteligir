// The cell's SQLite through drizzle, over the tables `@repo/db/cell/schema` declares, its DDL
// applied as it wakes (`../object-schema`).

import { defineRelations, getColumns, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import ddl from "@repo/db/cell/ddl.sql";
import * as cellSchema from "@repo/db/cell/schema";
import type { ObjectSchema } from "../object-schema";

// drizzle 1.0 registers a table only through `relations`, which also holds every table drizzle-kit
// alone reads to a use
const relations = defineRelations(cellSchema);

export type CellDb = DrizzleSqliteDODatabase<typeof relations>;

// holds only the storage, so a wipe leaves it whole
export const cellDbOf = (storage: DurableObjectStorage): CellDb => drizzle(storage, { relations });

export const CELL_SCHEMA: ObjectSchema = { ddl, what: "cell" };

// the row an upsert offered, for its SET, which sqlite-core spells by hand
export const excluded = (column: SQLiteColumn): SQL => sql`excluded.${sql.identifier(column.name)}`;

// A SQLite Durable Object binds at most 100 parameters to one statement and reads at most 100 KB
// of its text (https://developers.cloudflare.com/durable-objects/platform/limits/), so a statement
// carrying many rows or a long IN list is cut into several by the first; a value is bound, never
// spelled, so a statement held to 100 parameters holds no more text than its columns' names.
const SQL_MAX_PARAMS = 100;

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
