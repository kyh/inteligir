// What a statement over many rows is built of: rows a statement at a time, and ids as one array
// parameter, so a sweep or an import of thousands stays far inside Postgres's 65,535 parameters.

import { sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

export const chunksOf = <T>(rows: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let at = 0; at < rows.length; at += size) {
    chunks.push(rows.slice(at, at + size));
  }
  return chunks;
};

// the column is one of `values`; drizzle spreads a bare array into a parameter each
export const anyOf = (column: AnyColumn, values: readonly string[]): SQL =>
  sql`${column} = any(${sql.param([...values])}::text[])`;

// a text array as one parameter, which `unnest` turns back into rows
export const textArray = (values: readonly string[]): SQL => sql`${sql.param([...values])}::text[]`;
