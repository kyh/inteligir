// The outbox's table (`@repo/notes/library/library-schema`'s replica DDL), each row parsed on every
// read. A row this build cannot read is the store's corruption, never a row to drop: dropping it
// would drop what the person wrote.

import { OUTBOX_STATES } from "@repo/notes/library/library-schema";
import { all, LibraryRowError, run } from "@repo/notes/library/library-sql";
import type { SqlPlan, SqlRow } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { outboxOpSchema } from "./outbox-ops";
import type { OutboxOp } from "./outbox-ops";

export type OutboxRow = {
  // the row's place, oldest first
  readonly seq: number;
  // the key the cell keeps the row's answer under, so a resend after a lost answer lands once
  readonly opId: string;
  readonly op: OutboxOp;
  readonly createdAt: number;
} & (
  | { readonly state: "queued" | "sent"; readonly reason: null }
  // `reason`: why it waits for the person
  | { readonly state: "parked"; readonly reason: string }
);

const opJsonSchema = z.string().transform((text, context) => {
  try {
    return outboxOpSchema.parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not a write this build reads" });
    return z.NEVER;
  }
});

const rowColumns = {
  created_at: z.number(),
  op: opJsonSchema,
  op_id: z.string(),
  seq: z.number(),
};

const rowSchema = z.discriminatedUnion("state", [
  z.object({
    ...rowColumns,
    reason: z.null(),
    state: z.enum(OUTBOX_STATES).exclude(["parked"]),
  }),
  z.object({ ...rowColumns, reason: z.string(), state: z.literal("parked") }),
]);

const ROW_COLUMNS = "seq, op_id, op, state, reason, created_at";

const rowOf = (raw: SqlRow): OutboxRow => {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LibraryRowError("an outbox row is not one this build writes", {
      cause: parsed.error,
    });
  }
  const { created_at: createdAt, op_id: opId, ...row } = parsed.data;
  return { ...row, createdAt, opId };
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
    `INSERT INTO outbox (op_id, op, state, reason, created_at)
     VALUES (?, ?, 'queued', NULL, ?) RETURNING ${ROW_COLUMNS}`,
    [row.opId, opJsonOf(row.op), row.createdAt],
  );
  if (raw === undefined) {
    throw new LibraryRowError("an outbox row did not come back from its own insert");
  }
  return rowOf(raw);
};

export const saveRow = function* saveRow(row: OutboxRow): SqlPlan<void> {
  yield run("UPDATE outbox SET op_id = ?, op = ?, state = ?, reason = ? WHERE seq = ?", [
    row.opId,
    opJsonOf(row.op),
    row.state,
    row.reason,
    row.seq,
  ]);
};

export const deleteRow = function* deleteRow(seq: number): SqlPlan<void> {
  yield run("DELETE FROM outbox WHERE seq = ?", [seq]);
};

export const deleteAllRows = function* deleteAllRows(): SqlPlan<void> {
  yield run("DELETE FROM outbox");
};
