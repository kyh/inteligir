import { sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

export const chunksOf = <T>(rows: readonly T[], size: number) => {
  const chunks: T[][] = [];

  for (let at = 0; at < rows.length; at += size) {
    chunks.push(rows.slice(at, at + size));
  }

  return chunks;
};

export const anyOf = (column: AnyColumn, values: readonly string[]) =>
  sql`${column} = any(${sql.param([...values])}::text[])`;

export const textArray = (values: readonly string[]) => sql`${sql.param([...values])}::text[]`;
