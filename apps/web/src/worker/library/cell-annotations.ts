// An item's highlights as the cell holds them: one row each, a removal a deletion time rather than a
// missing row, so a replica pulls that it went and an undo brings it back whole. A write's
// highlight ops are guarded like a block, by the note text they were computed from; the
// annotation modules' store (the live entries) is what a change set's snapshot keeps and an undo
// hands back.

import type { annotationOpSchema } from "@repo/contract/cloud/library/library-wire";
import {
  annotationEntriesOf,
  annotationSourceSchema,
  sameAnnotationEntry,
} from "@repo/notes/annotations/store-schema";
import type {
  AnnotationEntry,
  AnnotationSource,
  AnnotationStore,
} from "@repo/notes/annotations/store-schema";
import { compareText } from "@repo/notes/library/block-order";
import { chunkStatement, LibraryRowError } from "@repo/notes/library/library-sql";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { ConflictCurrent } from "./cell-refusal";

type AnnotationOp = z.infer<typeof annotationOpSchema>;

export interface AnnotationRow {
  readonly id: string;
  readonly itemId: string;
  readonly parentId: string | null;
  readonly text: string;
  readonly quote: string | null;
  readonly occurrence: number | null;
  readonly source: AnnotationSource | null;
  // unix seconds, as an annotation entry keeps them
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
  readonly seq: number;
}

// an item's highlight rows by id, its removed ones included
export type AnnotationRows = ReadonlyMap<string, AnnotationRow>;

const rowSchema = z.object({
  created_at: z.number(),
  deleted_at: z.number().nullable(),
  id: z.string(),
  item_id: z.string(),
  occurrence: z.number().nullable(),
  parent_id: z.string().nullable(),
  quote: z.string().nullable(),
  seq: z.number(),
  source: annotationSourceSchema.nullable(),
  text: z.string(),
  updated_at: z.number(),
});

const COLUMNS =
  "id, item_id, parent_id, text, quote, occurrence, source, created_at, updated_at, deleted_at, seq";

const rowOf = (raw: SqlRow): AnnotationRow => {
  const row = rowSchema.safeParse(raw);
  if (!row.success) {
    throw new LibraryRowError("a highlight row is not what this build writes", {
      cause: row.error,
    });
  }
  return {
    createdAt: row.data.created_at,
    deletedAt: row.data.deleted_at,
    id: row.data.id,
    itemId: row.data.item_id,
    occurrence: row.data.occurrence,
    parentId: row.data.parent_id,
    quote: row.data.quote,
    seq: row.data.seq,
    source: row.data.source,
    text: row.data.text,
    updatedAt: row.data.updated_at,
  };
};

export const readAnnotationRows = (sql: SqlStatements, itemId: string): AnnotationRows =>
  new Map(
    sql
      .all(`SELECT ${COLUMNS} FROM annotations WHERE item_id = ?`, [itemId])
      .map(rowOf)
      .map((row) => [row.id, row]),
  );

export const readAnnotationRow = (sql: SqlStatements, id: string): AnnotationRow | null => {
  const [row] = sql.all(`SELECT ${COLUMNS} FROM annotations WHERE id = ?`, [id]);
  return row === undefined ? null : rowOf(row);
};

const entryOf = (row: AnnotationRow): AnnotationEntry => {
  const entry: AnnotationEntry = {
    createdAt: row.createdAt,
    text: row.text,
    updatedAt: row.updatedAt,
  };
  if (row.quote !== null) {
    entry.quote = row.quote;
  }
  if (row.source !== null) {
    entry.source = row.source;
  }
  if (row.parentId !== null) {
    entry.parentId = row.parentId;
  }
  return entry;
};

// the live highlights, as the annotation modules fold and revert them
export const annotationStoreOf = (rows: AnnotationRows): AnnotationStore => {
  const store: AnnotationStore = {};
  for (const row of [...rows.values()].toSorted((a, b) => compareText(a.id, b.id))) {
    if (row.deletedAt === null) {
      store[row.id] = entryOf(row);
    }
  }
  return store;
};

export interface AnnotationsLanded {
  readonly rows: AnnotationRows;
  // the ids whose rows the write changes, each stamped with the write's sequence number
  readonly changed: ReadonlySet<string>;
}

interface OpContext {
  readonly itemId: string;
  readonly source: AnnotationSource;
  readonly nowSeconds: number;
}

export interface AnnotationOpsOutcome {
  readonly landed: AnnotationsLanded;
  readonly conflicts: readonly ConflictCurrent[];
}

const conflictOf = (
  itemId: string,
  id: string,
  row: AnnotationRow | undefined,
): ConflictCurrent => ({
  current: row ?? null,
  id,
  itemId,
  kind: "annotation",
});

const live = (row: AnnotationRow | undefined): AnnotationRow | undefined =>
  row?.deletedAt === null ? row : undefined;

// the rows as the ops before this one left them, the ids they changed and what they met
interface OpRun {
  readonly rows: Map<string, AnnotationRow>;
  readonly changed: Set<string>;
  readonly conflicts: ConflictCurrent[];
  readonly context: OpContext;
}

type Op<K extends AnnotationOp["op"]> = Extract<AnnotationOp, { op: K }>;

// an add lands once; a reply answers a live root of the same item
const addAnnotation = (run: OpRun, op: Op<"add">): void => {
  const { itemId, nowSeconds, source } = run.context;
  const held = run.rows.get(op.id);
  if (held !== undefined) {
    const same =
      held.deletedAt === null &&
      held.text === op.text &&
      held.quote === op.quote &&
      held.parentId === op.parentId;
    if (!same) {
      run.conflicts.push(conflictOf(itemId, op.id, held));
    }
    return;
  }
  if (op.parentId !== null) {
    const parent = live(run.rows.get(op.parentId));
    if (parent === undefined || parent.parentId !== null) {
      run.conflicts.push(conflictOf(itemId, op.parentId, parent));
      return;
    }
  }
  run.rows.set(op.id, {
    createdAt: op.createdAt,
    deletedAt: null,
    id: op.id,
    itemId,
    occurrence: op.occurrence,
    parentId: op.parentId,
    quote: op.quote,
    seq: 0,
    source,
    text: op.text,
    updatedAt: nowSeconds,
  });
  run.changed.add(op.id);
};

const noteAnnotation = (run: OpRun, op: Op<"note">): void => {
  const held = run.rows.get(op.id);
  const current = live(held);
  if (current?.text === op.text) {
    return;
  }
  if (current === undefined || current.text !== op.base) {
    run.conflicts.push(conflictOf(run.context.itemId, op.id, held));
    return;
  }
  run.rows.set(op.id, { ...current, text: op.text, updatedAt: run.context.nowSeconds });
  run.changed.add(op.id);
};

// a root's replies go with it
const removeAnnotation = (run: OpRun, op: Op<"remove">): void => {
  const held = run.rows.get(op.id);
  const current = live(held);
  if (current === undefined) {
    return;
  }
  if (current.text !== op.base) {
    run.conflicts.push(conflictOf(run.context.itemId, op.id, held));
    return;
  }
  const at = run.context.nowSeconds;
  for (const row of run.rows.values()) {
    if ((row.id === op.id || row.parentId === op.id) && row.deletedAt === null) {
      run.rows.set(row.id, { ...row, deletedAt: at, updatedAt: at });
      run.changed.add(row.id);
    }
  }
};

// every op in order against the rows as the ones before it left them; one already true is
// satisfied
export const applyAnnotationOps = (
  rows: AnnotationRows,
  ops: readonly AnnotationOp[],
  context: OpContext,
): AnnotationOpsOutcome => {
  const run: OpRun = { changed: new Set(), conflicts: [], context, rows: new Map(rows) };
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        addAnnotation(run, op);
        break;
      }
      case "note": {
        noteAnnotation(run, op);
        break;
      }
      case "remove": {
        removeAnnotation(run, op);
        break;
      }
      // no default
    }
  }
  return { conflicts: run.conflicts, landed: { changed: run.changed, rows: run.rows } };
};

// the rows that hold exactly `store` live: what an undo hands back, each entry as it was, and every
// other row removed; a row keeps its occurrence, which no entry carries
export const restoreAnnotationStore = (
  rows: AnnotationRows,
  store: AnnotationStore,
  context: { readonly itemId: string; readonly nowSeconds: number },
): AnnotationsLanded => {
  const next = new Map(rows);
  const changed = new Set<string>();
  const wanted = annotationEntriesOf(store);
  for (const row of rows.values()) {
    if (row.deletedAt === null && !wanted.has(row.id)) {
      next.set(row.id, { ...row, deletedAt: context.nowSeconds, updatedAt: context.nowSeconds });
      changed.add(row.id);
    }
  }
  for (const [id, entry] of wanted) {
    const held = rows.get(id);
    const current = live(held);
    if (current !== undefined && sameAnnotationEntry(entryOf(current), entry)) {
      continue;
    }
    next.set(id, {
      createdAt: entry.createdAt,
      deletedAt: null,
      id,
      itemId: context.itemId,
      occurrence: held?.occurrence ?? null,
      parentId: entry.parentId ?? null,
      quote: entry.quote ?? null,
      seq: 0,
      source: entry.source ?? null,
      text: entry.text,
      updatedAt: entry.updatedAt,
    });
    changed.add(id);
  }
  return { changed, rows: next };
};

// the bytes of note text a write adds, which the quota counts
export const annotationGrowth = (before: AnnotationRows, after: AnnotationsLanded): number => {
  let growth = 0;
  for (const id of after.changed) {
    const was = before.get(id);
    const now = after.rows.get(id);
    const length = (row: AnnotationRow | undefined): number =>
      row === undefined || row.deletedAt !== null ? 0 : row.text.length + (row.quote?.length ?? 0);
    growth += length(now) - length(was);
  }
  return growth;
};

const UPSERT_HEAD = `INSERT INTO annotations (${COLUMNS}) VALUES `;
const UPSERT_TAIL = ` ON CONFLICT (id) DO UPDATE SET item_id = excluded.item_id,
  parent_id = excluded.parent_id, text = excluded.text, quote = excluded.quote,
  occurrence = excluded.occurrence, source = excluded.source, created_at = excluded.created_at,
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, seq = excluded.seq`;

// the changed rows, each stamped with the write's sequence number
export const storeAnnotationRows = (
  sql: SqlStatements,
  landed: AnnotationsLanded,
  seq: number,
): void => {
  const rows = [...landed.changed].flatMap((id) => {
    const row = landed.rows.get(id);
    return row === undefined
      ? []
      : [
          [
            row.id,
            row.itemId,
            row.parentId,
            row.text,
            row.quote,
            row.occurrence,
            row.source,
            row.createdAt,
            row.updatedAt,
            row.deletedAt,
            seq,
          ],
        ];
  });
  for (const statement of chunkStatement({
    each: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    head: UPSERT_HEAD,
    rows,
    separator: ", ",
    tail: UPSERT_TAIL,
  })) {
    sql.run(statement.sql, statement.params);
  }
};

// a pulled highlight row, as the wire names its fields
export const annotationWireRow = (row: AnnotationRow) => ({
  createdAt: row.createdAt,
  deletedAt: row.deletedAt,
  id: row.id,
  itemId: row.itemId,
  occurrence: row.occurrence,
  parentId: row.parentId,
  quote: row.quote,
  seq: row.seq,
  source: row.source,
  text: row.text,
  updatedAt: row.updatedAt,
});
