// The outbox's table (`@repo/notes/library/library-schema`'s replica DDL), each row parsed on every
// read. A row this build cannot read is the store's corruption, never a row to drop: dropping it
// would drop what the person wrote.

import { OUTBOX_STATES } from "@repo/notes/library/library-schema";
import { all, LibraryRowError, run } from "@repo/notes/library/library-sql";
import type { SqlPlan, SqlRow } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { itemIdOf, outboxOpSchema } from "./outbox-ops";
import type { OutboxOp } from "./outbox-ops";

type OutboxState = (typeof OUTBOX_STATES)[number];

export interface OutboxRow {
  // the row's place, oldest first
  readonly seq: number;
  // the key the cell keeps the row's answer under, so a resend after a lost answer lands once
  readonly opId: string;
  readonly itemId: string | null;
  readonly op: OutboxOp;
  readonly state: OutboxState;
  // why a parked row waits for the person
  readonly reason: string | null;
  readonly createdAt: number;
}

const opJsonSchema = z.string().transform((text, context) => {
  try {
    return outboxOpSchema.parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not a write this build reads" });
    return z.NEVER;
  }
});

const rowSchema = z.object({
  created_at: z.number(),
  item_id: z.string().nullable(),
  op: opJsonSchema,
  op_id: z.string(),
  reason: z.string().nullable(),
  seq: z.number(),
  state: z.enum(OUTBOX_STATES),
});

const ROW_COLUMNS = "seq, op_id, item_id, op, state, reason, created_at";

const rowOf = (raw: SqlRow): OutboxRow => {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LibraryRowError("an outbox row is not one this build writes", {
      cause: parsed.error,
    });
  }
  const row = parsed.data;
  return {
    createdAt: row.created_at,
    itemId: row.item_id,
    op: row.op,
    opId: row.op_id,
    reason: row.reason,
    seq: row.seq,
    state: row.state,
  };
};

export const readRows = function* readRows(): SqlPlan<OutboxRow[]> {
  return (yield all(`SELECT ${ROW_COLUMNS} FROM outbox ORDER BY seq`)).map(rowOf);
};

// a row's op as JSON, held to the schema every read parses it by, so no write leaves a row this
// build would refuse to read back
const opJsonOf = (op: OutboxOp): string => {
  const parsed = outboxOpSchema.safeParse(op);
  if (!parsed.success) {
    throw new LibraryRowError("an outbox row would hold a write this build does not read", {
      cause: parsed.error,
    });
  }
  return JSON.stringify(parsed.data);
};

export const insertRow = function* insertRow(row: {
  readonly opId: string;
  readonly op: OutboxOp;
  readonly createdAt: number;
}): SqlPlan<OutboxRow> {
  const [raw] = yield all(
    `INSERT INTO outbox (op_id, item_id, op, state, reason, created_at)
     VALUES (?, ?, ?, 'queued', NULL, ?) RETURNING ${ROW_COLUMNS}`,
    [row.opId, itemIdOf(row.op), opJsonOf(row.op), row.createdAt],
  );
  if (raw === undefined) {
    throw new LibraryRowError("an outbox row did not come back from its own insert");
  }
  return rowOf(raw);
};

export const saveRow = function* saveRow(row: OutboxRow): SqlPlan<void> {
  yield run(
    "UPDATE outbox SET op_id = ?, op = ?, item_id = ?, state = ?, reason = ? WHERE seq = ?",
    [row.opId, opJsonOf(row.op), itemIdOf(row.op), row.state, row.reason, row.seq],
  );
};

export const deleteRow = function* deleteRow(seq: number): SqlPlan<void> {
  yield run("DELETE FROM outbox WHERE seq = ?", [seq]);
};

export const deleteAllRows = function* deleteAllRows(): SqlPlan<void> {
  yield run("DELETE FROM outbox");
};
