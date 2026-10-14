// the phone's requests to a Mac, durable from the tap that asks one. Not a log outbox: the phone
// appends nothing to the thread log, and a row here leaves once a Mac's request carrying its id is
// in the log, or once the cloud says a Mac took an answer or a capture.

import { z } from "zod";
import {
  createDispatchRequestSchema,
  dispatchStatusSchema,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import type {
  CreateDispatchRequest,
  DispatchStatus,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import { fencedExclusive } from "../lib/phone-db";
import type { Fence } from "../lib/phone-db";
import type { SqlDriver, SqlExecutor } from "../lib/sql-driver";

export interface DispatchRow {
  request: CreateDispatchRequest;
  createdAt: number;
  // null until the cloud has taken the row
  status: DispatchStatus | null;
}

export interface DispatchOutbox {
  load: () => Promise<DispatchRow[]>;
  // each answers false when the fence fell before its transaction ran
  add: (row: DispatchRow, fence: Fence) => Promise<boolean>;
  setStatus: (id: string, status: DispatchStatus, fence: Fence) => Promise<boolean>;
  remove: (ids: readonly string[], fence: Fence) => Promise<boolean>;
  wipe: () => Promise<void>;
}

const columnsSchema = z.object({
  created_at: z.number(),
  request: z.string(),
  status: z.string().nullable(),
});

// a row this build cannot read throws: dropping it would drop the user's words
const rowOf = (columns: z.infer<typeof columnsSchema>): DispatchRow => ({
  createdAt: columns.created_at,
  request: createDispatchRequestSchema.parse(JSON.parse(columns.request)),
  status: columns.status === null ? null : dispatchStatusSchema.parse(JSON.parse(columns.status)),
});

const writeFenced = async (
  db: SqlDriver,
  fence: Fence,
  work: (tx: SqlExecutor) => Promise<void>,
): Promise<boolean> => {
  const written = await fencedExclusive(db, fence, work);
  return written.ran;
};

export const createDispatchOutbox = (db: SqlDriver): DispatchOutbox => ({
  add: async (row, fence) =>
    await writeFenced(db, fence, async (tx) => {
      await tx.run(
        "INSERT INTO dispatch_outbox (id, request, status, created_at) VALUES (?, ?, ?, ?)",
        [
          row.request.id,
          JSON.stringify(row.request),
          row.status === null ? null : JSON.stringify(row.status),
          row.createdAt,
        ],
      );
    }),

  load: async () => {
    const raw = await db.all(
      "SELECT request, status, created_at FROM dispatch_outbox ORDER BY seq",
    );
    return raw.map((row) => rowOf(columnsSchema.parse(row)));
  },

  remove: async (ids, fence) =>
    await writeFenced(db, fence, async (tx) => {
      for (const id of ids) {
        await tx.run("DELETE FROM dispatch_outbox WHERE id = ?", [id]);
      }
    }),

  setStatus: async (id, status, fence) =>
    await writeFenced(db, fence, async (tx) => {
      await tx.run("UPDATE dispatch_outbox SET status = ? WHERE id = ?", [
        JSON.stringify(status),
        id,
      ]);
    }),

  wipe: async () => {
    await db.exclusive(async (tx) => {
      await tx.run("DELETE FROM dispatch_outbox");
    });
  },
});
