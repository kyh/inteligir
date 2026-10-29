// What an export keeps between the alarm's runs (`./cell-exports`), a row per thing by its kind, so
// each run reads only what it writes: the plan's rows (the paths taken, how far a name's search
// for a free spelling got, each folder's path, each item's file in the plan's order, the items
// filed under each key a link resolves by, the files the items hold in the order they were
// placed), the zip's entries' records, the uploaded parts' etags by their numbers, and the zip's
// bytes past its last whole part.

import type { ExportStore } from "@repo/editor/codec/export-plan";
import { chunkStatement } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { ZipRecord } from "../zip/zip-write";

const MiB = 1024 * 1024;

// the kinds of row
export const ROWS = {
  doc: "doc",
  filing: "filing",
  folder: "folder",
  part: "part",
  placed: "placed",
  record: "record",
  searched: "searched",
  taken: "taken",
} as const;
type RowKind = (typeof ROWS)[keyof typeof ROWS];

export interface ExportRow {
  readonly key: string;
  readonly idx: number;
  readonly value: string;
}

const exportRowSchema = z.object({ idx: z.number().int(), key: z.string(), value: z.string() });

export const putRows = (
  sql: SqlStatements,
  exportId: string,
  kind: RowKind,
  rows: readonly ExportRow[],
): void => {
  for (const statement of chunkStatement({
    each: "(?, ?, ?, ?, ?)",
    head: "INSERT OR REPLACE INTO export_rows (export_id, kind, key, idx, value) VALUES ",
    rows: rows.map((row) => [exportId, kind, row.key, row.idx, row.value]),
    separator: ", ",
  })) {
    sql.run(statement.sql, statement.params);
  }
};

// the first row of a kind under `key`, or null
export const rowValue = (
  sql: SqlStatements,
  exportId: string,
  kind: RowKind,
  key: string,
): string | null => {
  const [raw] = sql.all(
    "SELECT key, idx, value FROM export_rows WHERE export_id = ? AND kind = ? AND key = ? LIMIT 1",
    [exportId, kind, key],
  );
  return raw === undefined ? null : exportRowSchema.parse(raw).value;
};

// every row of a kind under `key`
export const rowsUnder = (
  sql: SqlStatements,
  exportId: string,
  kind: RowKind,
  key: string,
): string[] =>
  sql
    .all("SELECT key, idx, value FROM export_rows WHERE export_id = ? AND kind = ? AND key = ?", [
      exportId,
      kind,
      key,
    ])
    .map((raw) => exportRowSchema.parse(raw).value);

// a kind's rows from `from` in their order, at most `limit`
export const rowsFrom = (
  sql: SqlStatements,
  exportId: string,
  kind: RowKind,
  from: number,
  limit: number,
): ExportRow[] =>
  sql
    .all(
      `SELECT key, idx, value FROM export_rows WHERE export_id = ? AND kind = ? AND idx >= ?
       ORDER BY idx LIMIT ?`,
      [exportId, kind, from, limit],
    )
    .map((raw) => exportRowSchema.parse(raw));

const countSchema = z.object({ n: z.number().int().nonnegative() });

export const rowCount = (sql: SqlStatements, exportId: string, kind: RowKind): number =>
  countSchema.parse(
    sql.all("SELECT count(*) AS n FROM export_rows WHERE export_id = ? AND kind = ?", [
      exportId,
      kind,
    ])[0],
  ).n;

export const dropExportRows = (sql: SqlStatements, exportId: string): void => {
  sql.run("DELETE FROM export_rows WHERE export_id = ?", [exportId]);
  sql.run("DELETE FROM export_tail WHERE export_id = ?", [exportId]);
};

// the bytes past the zip's last whole part, in chunks whose base64 stays under a row's 2 MB
const TAIL_CHUNK = MiB;
// the bytes one call spells as a string's code units, well inside a call's arguments
const SPELL_CHUNK = 0x80_00;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += SPELL_CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(at, at + SPELL_CHUNK));
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.codePointAt(at) ?? 0;
  }
  return bytes;
};

const tailSchema = z.object({ base64: z.string() });

export const readTail = (sql: SqlStatements, exportId: string): Uint8Array[] =>
  sql
    .all("SELECT base64 FROM export_tail WHERE export_id = ? ORDER BY idx", [exportId])
    .map((raw) => fromBase64(tailSchema.parse(raw).base64));

export const writeTail = (sql: SqlStatements, exportId: string, tail: Uint8Array): void => {
  sql.run("DELETE FROM export_tail WHERE export_id = ?", [exportId]);
  for (let at = 0; at < tail.length; at += TAIL_CHUNK) {
    sql.run("INSERT INTO export_tail (export_id, idx, base64) VALUES (?, ?, ?)", [
      exportId,
      at / TAIL_CHUNK,
      toBase64(tail.subarray(at, at + TAIL_CHUNK)),
    ]);
  }
};

export const docRowSchema = z.object({
  aliases: z.array(z.string()),
  name: z.string(),
  path: z.string(),
});
export type DocRow = z.infer<typeof docRowSchema>;

export const filedSchema = z.object({ aliases: z.array(z.string()), path: z.string() });

export const placedSchema = z.object({ path: z.string(), sha: z.string() });

export const recordSchema = z.object({
  compressed: z.number(),
  crc: z.number(),
  date: z.number(),
  method: z.number(),
  offset: z.number(),
  path: z.string(),
  size: z.number(),
  time: z.number(),
}) satisfies z.ZodType<ZipRecord>;

export const json = <T>(schema: z.ZodType<T>, text: string): T => schema.parse(JSON.parse(text));

// the plan's store over the export's rows, what a run adds held apart until its end writes it
export interface RunStore extends ExportStore {
  readonly keep: (sql: SqlStatements) => void;
}

export type Look = <T>(work: (sql: SqlStatements) => T) => T;

export const runStore = (exportId: string, look: Look): RunStore => {
  const taken = new Map<string, string>();
  const searched = new Map<string, number>();
  const placed = new Map<string, z.infer<typeof placedSchema>>();
  return {
    keep: (sql) => {
      putRows(
        sql,
        exportId,
        ROWS.taken,
        [...taken].map(([key, path]) => ({ idx: 0, key, value: path })),
      );
      putRows(
        sql,
        exportId,
        ROWS.searched,
        [...searched].map(([key, n]) => ({ idx: 0, key, value: String(n) })),
      );
      const from = rowCount(sql, exportId, ROWS.placed);
      putRows(
        sql,
        exportId,
        ROWS.placed,
        [...placed].map(([key, file], index) => ({
          idx: from + index,
          key,
          value: JSON.stringify(file),
        })),
      );
    },
    place: (key, file) => {
      placed.set(key, file);
    },
    placed: (key) => {
      const held = placed.get(key)?.path;
      if (held !== undefined) {
        return held;
      }
      const row = look((sql) => rowValue(sql, exportId, ROWS.placed, key));
      return row === null ? null : json(placedSchema, row).path;
    },
    search: (key, n) => {
      searched.set(key, n);
    },
    searched: (key) => {
      const held = searched.get(key);
      if (held !== undefined) {
        return held;
      }
      const row = look((sql) => rowValue(sql, exportId, ROWS.searched, key));
      return row === null ? null : Number(row);
    },
    take: (key, path) => {
      taken.set(key, path);
    },
    taken: (key) =>
      taken.has(key) || look((sql) => rowValue(sql, exportId, ROWS.taken, key) !== null),
  };
};
