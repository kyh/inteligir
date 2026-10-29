// The replica's queued writes, sent oldest first. A write is durable in the replica's own
// transaction before it resolves, and the overlay lays it over what the screens read from then
// on. A row is pinned before it first goes, so a resend after a lost answer is the same call
// under the same op id, which the cell answers once; the files it names go to `/v1/blobs` first. A
// CONFLICT settles through the block merge and goes again; a refusal no resend passes parks the
// row for the person, holding the rows on its item behind it while every other item goes on; no
// answer stops the pass with every row kept.

import { isDefinedError, safe } from "@orpc/client";
import type { V1Client } from "@repo/contract/cloud/v1";
import { blockHash } from "@repo/notes/library/block-hash";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import type { SqlPlan } from "@repo/notes/library/library-sql";
import type { liveItemRowSchema } from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";

import { sharedFailure, uploadBlob } from "./call-outcome";
import type { CallFailure } from "./call-outcome";
import { coalesceWrites, itemIdsOf, stagedOf } from "./outbox-ops";
import type { OutboxOp, WriteOp } from "./outbox-ops";
import { deleteAllRows, deleteRow, insertRow, readRow, readRows, saveRow } from "./outbox-rows";
import type { OutboxRow } from "./outbox-rows";
import { settleFolders, settleWrite } from "./outbox-settle";
import type { Settled } from "./outbox-settle";
import { layRow } from "./overlay";
import type {
  BlockMerge,
  NewId,
  ReplicaClock,
  ReplicaSql,
  ReplicaTransport,
  StagedBlobs,
} from "./replica-ports";
import {
  landOwnAnnotations,
  landOwnFolders,
  landOwnRow,
  markDeleted,
  touchedNothing,
} from "./replica-rows";
import type { Touched } from "./replica-rows";

type LiveItemRow = z.infer<typeof liveItemRowSchema>;

// a row whose every resend meets a library that moved again waits for the next pass
const MAX_ROUNDS_PER_ROW = 3;
// bounds one pass, so the pull after it is never starved and a close waits out few calls
const MAX_ROWS_PER_PASS = 100;

export const STAGED_FILE_GONE = "This file is no longer on this device.";
const FILE_NOT_STAGED = "A file this names was never on this device.";
const KEPT_CHANGING = "Your library kept changing while this device saved. It will try again.";

export interface OutboxContext {
  readonly sql: ReplicaSql;
  readonly client: V1Client;
  readonly transport: ReplicaTransport;
  readonly blobs: StagedBlobs;
  readonly merge: BlockMerge;
  readonly newId: NewId;
  readonly clock: ReplicaClock;
  // false once the replica is closed: an answer heard after lands nothing
  readonly live: () => boolean;
  // the rows moved, or a landing laid the replica's own: what the screens read again, over the
  // rows as they now stand
  readonly changed: (touched: Touched, rows: readonly OutboxRow[]) => Promise<void>;
}

type DrainOutcome =
  | { readonly kind: "caught-up" }
  | { readonly kind: "more" }
  | { readonly kind: "stopped"; readonly failure: CallFailure }
  | { readonly kind: "closed" };

type SendOutcome =
  | { readonly kind: "landed" }
  | { readonly kind: "again" }
  | { readonly kind: "parked" }
  | { readonly kind: "stopped"; readonly failure: CallFailure }
  | { readonly kind: "closed" };

export interface Outbox {
  readonly load: () => Promise<void>;
  readonly rows: () => readonly OutboxRow[];
  // durable before it resolves; a write joins the item's row still queued, and null is a write
  // that, joined, changes nothing, whose row goes
  readonly enqueue: (op: OutboxOp) => Promise<OutboxRow | null>;
  readonly drain: () => Promise<DrainOutcome>;
  // a parked row goes again
  readonly retry: (seq: number) => Promise<void>;
  // a parked row's change is let go
  readonly discard: (seq: number) => Promise<void>;
  readonly wipe: () => Promise<void>;
}

// what a row holds a later row behind: the items it writes, and the folder tree for a folder write
const holdsOf = (op: OutboxOp): readonly string[] =>
  op.kind === "folders" ? ["#folders"] : itemIdsOf(op);

// oldest first; a row on an item a parked row writes, or one held behind such a row, waits
const nextToSend = (rows: readonly OutboxRow[]): OutboxRow | null => {
  const held = new Set<string>();
  for (const row of rows) {
    const holds = holdsOf(row.op);
    if (row.state !== "parked" && !holds.some((id) => held.has(id))) {
      return row;
    }
    for (const id of holds) {
      held.add(id);
    }
  }
  return null;
};

const touchedItems = (ids: readonly string[]): Touched => {
  const touched = touchedNothing();
  if (ids.length > 0) {
    touched.kinds.add("item");
  }
  for (const id of ids) {
    touched.ids.add(id);
  }
  return touched;
};

const stored = (placed: {
  readonly block: StoredBlock["block"];
  readonly ord: string;
  readonly section: StoredBlock["section"];
}): StoredBlock => ({ ...placed, hash: blockHash(placed.block) });

// the blocks a write lands as the cell does: each one it inserts, puts or moves, as the item this
// replica holds is with the write laid over, and each it drops
const blocksOfWrite = function* blocksOfWrite(
  op: WriteOp,
  createdAt: number,
): SqlPlan<{ readonly written: StoredBlock[]; readonly dropped: string[] }> {
  const held = yield* readItemState(op.itemId);
  const laid = layRow(held, op, createdAt);
  const written: StoredBlock[] = [];
  const dropped: string[] = [];
  for (const libraryOp of op.ops) {
    if (libraryOp.op === "drop") {
      dropped.push(libraryOp.blockId);
      continue;
    }
    if (libraryOp.op === "insert" || libraryOp.op === "put" || libraryOp.op === "move") {
      const id = libraryOp.op === "move" ? libraryOp.blockId : libraryOp.block.id;
      const block = laid?.blocks.get(id);
      if (block !== undefined) {
        written.push(block);
      }
    }
  }
  return { dropped, written };
};

export const createOutbox = (context: OutboxContext): Outbox => {
  const { blobs, client, sql } = context;
  let rows: OutboxRow[] = [];
  // the files this session has put, which a resend need not put again: a BLOB_MISSING puts them
  // anyway
  const uploaded = new Set<string>();

  const replace = (next: OutboxRow): void => {
    rows = rows.map((row) => (row.seq === next.seq ? next : row));
  };

  const forget = (seq: number): void => {
    rows = rows.filter((row) => row.seq !== seq);
  };

  const changedRow = async (op: OutboxOp): Promise<void> => {
    const touched = touchedItems(itemIdsOf(op));
    touched.kinds.add("folder");
    await context.changed(touched, rows);
  };

  // a staged file goes once no row names it; two rows staging the same bytes share one
  const release = async (op: OutboxOp): Promise<void> => {
    for (const file of stagedOf(op)) {
      if (rows.some((row) => stagedOf(row.op).some((held) => held.sha === file.sha))) {
        continue;
      }
      uploaded.delete(file.sha);
      await blobs.remove(file.sha);
    }
  };

  const park = async (row: OutboxRow, reason: string): Promise<SendOutcome> => {
    const parked: OutboxRow = { ...row, reason, state: "parked" };
    await sql.exclusive(async (tx) => {
      if ((await runPlanAsync(tx, readRow(row.seq))) !== null) {
        await runPlanAsync(tx, saveRow(parked));
      }
    });
    replace(parked);
    await changedRow(row.op);
    return { kind: "parked" };
  };

  const resend = async (row: OutboxRow, op: OutboxOp): Promise<SendOutcome> => {
    const next: OutboxRow = { ...row, op };
    await sql.exclusive(async (tx) => {
      await runPlanAsync(tx, saveRow(next));
    });
    replace(next);
    await changedRow(op);
    return { kind: "again" };
  };

  // the row is retired in the transaction that lays what it landed
  const land = async (
    row: OutboxRow,
    work: () => SqlPlan<void>,
    touched: Touched,
  ): Promise<SendOutcome> => {
    await sql.exclusive(async (tx) => {
      await runPlanAsync(tx, deleteRow(row.seq));
      await runPlanAsync(tx, work());
    });
    forget(row.seq);
    await release(row.op);
    for (const id of itemIdsOf(row.op)) {
      touched.ids.add(id);
    }
    touched.kinds.add("item");
    await context.changed(touched, rows);
    return { kind: "landed" };
  };

  const landItem = async (
    row: OutboxRow,
    item: LiveItemRow,
    blocksOf: () => SqlPlan<{ readonly written: StoredBlock[]; readonly dropped: string[] }>,
  ): Promise<SendOutcome> =>
    await land(
      row,
      function* landed() {
        yield* landOwnRow(item, yield* blocksOf());
      },
      touchedItems([item.id]),
    );

  const settled = async <T>(
    row: OutboxRow,
    outcome: Settled<T>,
    again: (op: T) => OutboxOp,
  ): Promise<SendOutcome> => {
    if (outcome.kind === "satisfied") {
      return await land(
        row,
        function* nothing() {
          yield* [];
        },
        touchedNothing(),
      );
    }
    return await resend(row, again(outcome.op));
  };

  // a refusal the procedure declares, or one every call shares
  const refused = async (
    row: OutboxRow,
    error: Error,
    own: () => Promise<SendOutcome> | null,
  ): Promise<SendOutcome> => {
    const shared = sharedFailure(error);
    if (shared !== null) {
      return shared.kind === "malformed"
        ? await park(row, shared.message)
        : { failure: shared, kind: "stopped" };
    }
    return (await own()) ?? (await park(row, error.message));
  };

  // the row's files before the call that names them; null once all of them are up
  const putStaged = async (
    row: OutboxRow,
    shas: readonly string[] | null,
  ): Promise<SendOutcome | null> => {
    const staged = stagedOf(row.op);
    const wanted = shas ?? staged.filter((file) => !uploaded.has(file.sha)).map((file) => file.sha);
    for (const sha of wanted) {
      const file = staged.find((held) => held.sha === sha);
      if (file === undefined) {
        return await park(row, FILE_NOT_STAGED);
      }
      const bytes = await blobs.read(sha);
      if (bytes === null) {
        return await park(row, STAGED_FILE_GONE);
      }
      const outcome = await uploadBlob(context.transport, { ...file, bytes });
      if (!context.live()) {
        return { kind: "closed" };
      }
      switch (outcome.kind) {
        case "stored": {
          uploaded.add(sha);
          break;
        }
        case "again": {
          return { kind: "again" };
        }
        case "refused": {
          return await park(row, outcome.reason);
        }
        case "failed": {
          return { failure: outcome.failure, kind: "stopped" };
        }
        // no default
      }
    }
    return null;
  };

  const missingFiles = async (row: OutboxRow, shas: readonly string[]): Promise<SendOutcome> => {
    for (const sha of shas) {
      uploaded.delete(sha);
    }
    return (await putStaged(row, shas)) ?? { kind: "again" };
  };

  const sendWrite = async (row: OutboxRow, op: WriteOp): Promise<SendOutcome> => {
    const [error, answer] = await safe(
      client.library.write({
        annotations: op.annotations,
        itemId: op.itemId,
        opId: row.opId,
        ops: op.ops,
      }),
    );
    if (!context.live()) {
      return { kind: "closed" };
    }
    if (error === null) {
      const atSeconds = Math.floor(context.clock.now() / 1000);
      const touched = touchedItems([op.itemId]);
      if (op.annotations.length > 0) {
        touched.kinds.add("annotation");
      }
      return await land(
        row,
        function* landed() {
          yield* landOwnRow(answer.item, yield* blocksOfWrite(op, row.createdAt));
          yield* landOwnAnnotations(op.itemId, op.annotations, atSeconds);
        },
        touched,
      );
    }
    return await refused(row, error, () => {
      if (!isDefinedError(error)) {
        return null;
      }
      switch (error.code) {
        case "CONFLICT": {
          return settled(
            row,
            settleWrite(op, error.data.current, { merge: context.merge, newId: context.newId }),
            (again) => again,
          );
        }
        case "BLOB_MISSING": {
          return missingFiles(row, error.data.shas);
        }
        default: {
          return null;
        }
      }
    });
  };

  const sendMake = async (
    row: OutboxRow,
    op: Extract<OutboxOp, { kind: "create" | "saveLink" | "save" | "createFile" }>,
  ): Promise<SendOutcome> => {
    const { opId } = row;
    const call = async () => {
      switch (op.kind) {
        case "create": {
          return await safe(client.library.items.create({ ...op.input, opId }));
        }
        case "saveLink": {
          return await safe(client.library.items.saveLink({ ...op.input, opId }));
        }
        case "save": {
          return await safe(client.library.items.save({ ...op.input, opId }));
        }
        case "createFile": {
          return await safe(client.library.items.createFile({ ...op.input, opId }));
        }
        // no default
      }
    };
    const [error, answer] = await call();
    if (!context.live()) {
      return { kind: "closed" };
    }
    if (error === null) {
      const folded = "folded" in answer && answer.folded;
      return await landItem(row, answer.item, function* blocksOfMake() {
        yield* [];
        if (op.kind === "create") {
          return { dropped: [], written: op.input.blocks.map(stored) };
        }
        if (op.kind === "save" && !folded) {
          return {
            dropped: [],
            written: op.input.article.map((placed) => stored({ ...placed, section: "article" })),
          };
        }
        return { dropped: [], written: [] };
      });
    }
    return await refused(row, error, () =>
      isDefinedError(error) && error.code === "BLOB_MISSING" && "shas" in error.data
        ? missingFiles(row, error.data.shas)
        : null,
    );
  };

  const sendDeletion = async (
    row: OutboxRow,
    op: Extract<OutboxOp, { kind: "delete" | "restore" }>,
  ): Promise<SendOutcome> => {
    const [error, answer] =
      op.kind === "delete"
        ? await safe(client.library.items.delete({ ids: op.ids, opId: row.opId }))
        : await safe(client.library.items.restore({ ids: op.ids, opId: row.opId }));
    if (!context.live()) {
      return { kind: "closed" };
    }
    if (error !== null) {
      return await refused(row, error, () => null);
    }
    const changed = "deleted" in answer ? answer.deleted : answer.restored;
    const at = op.kind === "delete" ? row.createdAt : null;
    return await land(
      row,
      function* landed() {
        yield* markDeleted(changed, at);
      },
      touchedItems(changed),
    );
  };

  const sendFolders = async (
    row: OutboxRow,
    op: Extract<OutboxOp, { kind: "folders" }>,
  ): Promise<SendOutcome> => {
    const [error] = await safe(client.library.folders.write({ opId: row.opId, ops: op.ops }));
    if (!context.live()) {
      return { kind: "closed" };
    }
    if (error === null) {
      const touched = touchedNothing();
      touched.kinds.add("folder");
      return await land(
        row,
        function* landed() {
          yield* landOwnFolders(op.ops, row.createdAt);
        },
        touched,
      );
    }
    return await refused(row, error, () =>
      isDefinedError(error) && error.code === "CONFLICT"
        ? settled(row, settleFolders(op.ops, error.data.current), (ops) => ({
            kind: "folders",
            ops,
          }))
        : null,
    );
  };

  // pinned before it first goes, so every resend is the call that went
  const pin = async (row: OutboxRow): Promise<OutboxRow> => {
    if (row.state !== "queued") {
      return row;
    }
    const pinned: OutboxRow = { ...row, state: "sent" };
    await sql.exclusive(async (tx) => {
      await runPlanAsync(tx, saveRow(pinned));
    });
    replace(pinned);
    return pinned;
  };

  const send = async (queued: OutboxRow): Promise<SendOutcome> => {
    const row = await pin(queued);
    const staged = await putStaged(row, null);
    if (staged !== null) {
      return staged;
    }
    const { op } = row;
    switch (op.kind) {
      case "write": {
        return await sendWrite(row, op);
      }
      case "create":
      case "saveLink":
      case "save":
      case "createFile": {
        return await sendMake(row, op);
      }
      case "delete":
      case "restore": {
        return await sendDeletion(row, op);
      }
      case "folders": {
        return await sendFolders(row, op);
      }
      // no default
    }
  };

  return {
    discard: async (seq) => {
      const row = rows.find((candidate) => candidate.seq === seq);
      if (row === undefined || row.state !== "parked") {
        return;
      }
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, deleteRow(seq));
      });
      forget(seq);
      await release(row.op);
      await changedRow(row.op);
    },

    drain: async () => {
      const rounds = new Map<number, number>();
      for (let sent = 0; sent < MAX_ROWS_PER_PASS; sent += 1) {
        if (!context.live()) {
          return { kind: "closed" };
        }
        const row = nextToSend(rows);
        if (row === null) {
          return { kind: "caught-up" };
        }
        const round = (rounds.get(row.seq) ?? 0) + 1;
        rounds.set(row.seq, round);
        if (round > MAX_ROUNDS_PER_ROW) {
          return { failure: { kind: "unreachable", message: KEPT_CHANGING }, kind: "stopped" };
        }
        const outcome = await send(row);
        if (outcome.kind === "stopped" || outcome.kind === "closed") {
          return outcome;
        }
      }
      return { kind: "more" };
    },

    enqueue: async (op) => {
      const createdAt = context.clock.now();
      const written = await sql.exclusive(async (tx) => {
        // the last row naming the item, a delete or a restore of several included, so a write
        // joins only a write nothing on its item has queued behind
        const last =
          op.kind === "write"
            ? rows.findLast((row) => itemIdsOf(row.op).includes(op.itemId))
            : undefined;
        if (op.kind === "write" && last?.state === "queued" && last.op.kind === "write") {
          const joined = coalesceWrites(last.op, op);
          if (joined.ops.length === 0 && joined.annotations.length === 0) {
            await runPlanAsync(tx, deleteRow(last.seq));
            return { kind: "dropped", row: last } as const;
          }
          const next: OutboxRow = { ...last, op: joined };
          await runPlanAsync(tx, saveRow(next));
          return { kind: "joined", row: next } as const;
        }
        const row = await runPlanAsync(tx, insertRow({ createdAt, op, opId: context.newId() }));
        return { kind: "inserted", row } as const;
      });
      switch (written.kind) {
        case "dropped": {
          forget(written.row.seq);
          await release(written.row.op);
          break;
        }
        case "joined": {
          replace(written.row);
          break;
        }
        case "inserted": {
          rows = [...rows, written.row];
          break;
        }
        // no default
      }
      await changedRow(op);
      return written.kind === "dropped" ? null : written.row;
    },

    load: async () => {
      rows = await runPlanAsync(sql, readRows());
    },

    retry: async (seq) => {
      const row = rows.find((candidate) => candidate.seq === seq);
      if (row === undefined || row.state !== "parked") {
        return;
      }
      // it may have gone before it parked, so it goes again as it went
      const next: OutboxRow = { ...row, reason: null, state: "sent" };
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, saveRow(next));
      });
      replace(next);
      await changedRow(row.op);
    },

    rows: () => rows,

    wipe: async () => {
      rows = [];
      uploaded.clear();
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, deleteAllRows());
      });
      await blobs.clear();
    },
  };
};
