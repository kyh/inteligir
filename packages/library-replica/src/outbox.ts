// The replica's queued writes, sent oldest first. A write is durable in the replica's own
// transaction before it resolves, and the overlay lays it over what the screens read from then
// on. A row is pinned before it first goes, so a resend after a lost answer is the same call
// under the same op id, which the cell answers once; the files it names go to `/v1/blobs` first. A
// CONFLICT settles through the block merge and goes again; a refusal no resend passes parks the
// row for the person, holding the rows on its items or folders behind it while everything else
// goes on; no answer stops the pass with every row kept. The outbox's changes run one at a time,
// each over the rows as the one before it left them, so a write that joins a row and the pass that
// pins it never decide on two different rows.

import { isDefinedError, safe } from "@orpc/client";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import { sameJson } from "@repo/notes/library/canonical-json";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import type { SqlPlan } from "@repo/notes/library/library-sql";
import type { liveItemRowSchema } from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";

import { CHANGE_REFUSED, sharedFailure, uploadBlob } from "./call-outcome";
import type { CallFailure } from "./call-outcome";
import type { FoldedMakes } from "./folded-makes";
import {
  coalesceWrites,
  foldersFiledIn,
  foldersMadeBy,
  itemIdsOf,
  repointedOp,
  shasNamed,
  stagedOf,
  unfiledOp,
} from "./outbox-ops";
import type { OutboxOp, WriteOp } from "./outbox-ops";
import { deleteAllRows, deleteRow, insertRow, readRows, saveRow } from "./outbox-rows";
import type { OutboxRow } from "./outbox-rows";
import { settleFolders, settleWrite } from "./outbox-settle";
import type { Settled } from "./outbox-settle";
import { layRow, madeBy } from "./overlay";
import { serialLock } from "./serial-lock";
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
  markRestored,
  touchedNothing,
} from "./replica-rows";
import type { Touched } from "./replica-rows";

type LiveItemRow = z.infer<typeof liveItemRowSchema>;

// a row whose every resend meets a library that moved again waits for the next pass; one the last
// resend left as it was would meet the same answer there, so it parks
const MAX_ROUNDS_PER_ROW = 3;
// bounds one pass, so the pull after it is never starved
const MAX_ROWS_PER_PASS = 100;

/** @internal */
export const STAGED_FILE_GONE = "This file is no longer on this device.";
const FILE_NOT_STAGED = "A file this names was never on this device.";
const KEPT_CHANGING = "Your library kept changing while this device saved. It will try again.";
const ADDRESS_HELD =
  "Another item already holds this address. Delete it and try again, or let this change go.";

// A write the closed replica refused: the account it wrote for has left this device, or is
// leaving, so a row laid now would sit in the wiped database for whoever signs in next. Its message
// is the person's; a caller that can hold the write for the next sign-in reads its type.
export class ReplicaClosedError extends Error {
  constructor() {
    super("This device is signed out of your library, so this wasn't saved.");
    this.name = "ReplicaClosedError";
  }
}

export interface OutboxContext {
  readonly sql: ReplicaSql;
  readonly client: V1Client;
  readonly transport: ReplicaTransport;
  readonly blobs: StagedBlobs;
  readonly merge: BlockMerge;
  readonly newId: NewId;
  readonly clock: ReplicaClock;
  readonly folded: FoldedMakes;
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
  // nothing is left of the row: a later write joined it to no change while it waited
  | { readonly kind: "gone" }
  | { readonly kind: "again" }
  | { readonly kind: "parked" }
  | { readonly kind: "stopped"; readonly failure: CallFailure }
  | { readonly kind: "closed" };

// a make the cell folded onto the item already at its address, which never takes the make's own id
interface Fold {
  readonly from: string;
  readonly to: string;
}

// a file a row stages, put on the device with the row that names it
export interface StagedBytes {
  readonly sha: string;
  readonly mime: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface Outbox {
  readonly load: () => Promise<void>;
  readonly rows: () => readonly OutboxRow[];
  // durable before it resolves, its files staged first, and refused once the replica closed; a
  // write joins the item's last row while that one is still queued, and a row a join leaves
  // changing nothing goes
  readonly enqueue: (op: OutboxOp, files: readonly StagedBytes[]) => Promise<void>;
  readonly drain: () => Promise<DrainOutcome>;
  // a parked row goes again
  readonly retry: (seq: number) => Promise<void>;
  // a parked row's change is let go
  readonly discard: (seq: number) => Promise<void>;
  readonly wipe: () => Promise<void>;
}

// what a row holds a later row behind: the items or the folders it writes, so a refused folder
// leaves the person free to rename the one in its way
const holdsOf = (op: OutboxOp): readonly string[] =>
  op.kind === "folders"
    ? [...op.ops.map((folder) => folder.id), ...foldersFiledIn(op)]
    : itemIdsOf(op);

// oldest first; a row on what a parked row writes, or on what one held behind such a row writes,
// waits, and so does a row filing into a folder no row has made yet, whose id the cell would take
// or refuse with nothing there. A folder that stands files what comes, whatever parked on it
const nextToSend = (rows: readonly OutboxRow[]): OutboxRow | null => {
  const held = new Set<string>();
  const unmade = new Set<string>();
  for (const row of rows) {
    const holds = holdsOf(row.op);
    const waits =
      holds.some((id) => held.has(id)) || foldersFiledIn(row.op).some((id) => unmade.has(id));
    if (row.state !== "parked" && !waits) {
      return row;
    }
    for (const id of holds) {
      held.add(id);
    }
    for (const id of foldersMadeBy(row.op)) {
      unmade.add(id);
    }
  }
  return null;
};

// a write joined to `row` would file past the row behind it that makes the folder, and go first
const filesAheadOf = (op: WriteOp, row: OutboxRow, rows: readonly OutboxRow[]): boolean => {
  const filed = foldersFiledIn(op);
  return rows.some(
    (behind) => behind.seq > row.seq && foldersMadeBy(behind.op).some((id) => filed.includes(id)),
  );
};

// a queued row as another row's end left it, null where that leaves it asking nothing
interface Rewritten {
  readonly held: OutboxRow;
  readonly op: OutboxOp | null;
}

const saveRewritten = function* saveRewritten(rewritten: readonly Rewritten[]): SqlPlan<void> {
  for (const { held, op } of rewritten) {
    yield* op === null ? deleteRow(held.seq) : saveRow({ ...held, op });
  }
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

// a write or a new note names a file a row still stages, a picture kept as it was pasted: the row
// stages it too, so its bytes stay until this row lands and a BLOB_MISSING it meets sends them
// again. A file no row stages any more is the cloud's already
const withKeptFiles = (op: OutboxOp, rows: readonly OutboxRow[]): OutboxOp => {
  if (op.kind !== "write" && op.kind !== "create") {
    return op;
  }
  const staged = [...op.staged];
  for (const sha of shasNamed(op)) {
    if (staged.some((file) => file.sha === sha)) {
      continue;
    }
    const held = rows.flatMap((row) => stagedOf(row.op)).find((file) => file.sha === sha);
    if (held !== undefined) {
      staged.push(held);
    }
  }
  return { ...op, staged };
};

export const createOutbox = (context: OutboxContext): Outbox => {
  const { blobs, client, folded, sql } = context;
  // one change to the outbox at a time, from its transaction through the rows it leaves in memory
  // and the staged files it puts or lets go, so each change decides on the rows the table holds: a
  // pass's pin reads the row a write may have joined since the pass chose it, and a write never
  // joins a row a pin has sent. A call to the cloud runs outside it
  const hold = serialLock();
  // the table's rows, as the last change that committed left them
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

  // `overlapped`: the items a settle merged this device's lines into over the other device's
  const changedRow = async (op: OutboxOp, overlapped: readonly string[]): Promise<void> => {
    const touched = touchedItems(itemIdsOf(op));
    touched.kinds.add("folder");
    for (const id of overlapped) {
      touched.overlapped.add(id);
    }
    await context.changed(touched, rows);
  };

  // a staged file goes once no row names it, under the hold, so no row staging the same bytes is
  // on its way meanwhile; two rows staging them share one
  const release = async (op: OutboxOp): Promise<void> => {
    for (const file of stagedOf(op)) {
      if (rows.some((row) => stagedOf(row.op).some((held) => held.sha === file.sha))) {
        continue;
      }
      uploaded.delete(file.sha);
      await blobs.remove(file.sha);
    }
  };

  const adopt = async (rewritten: readonly Rewritten[]): Promise<void> => {
    for (const { held, op } of rewritten) {
      if (op === null) {
        forget(held.seq);
        await release(held.op);
      } else {
        replace({ ...held, op });
      }
    }
  };

  const park = async (
    row: OutboxRow,
    reason: string,
    rest: Pick<OutboxRow, "op" | "opId"> | null = null,
  ): Promise<SendOutcome> => {
    const parked: OutboxRow = { ...row, ...rest, reason, state: "parked" };
    await hold(async () => {
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, saveRow(parked));
      });
      replace(parked);
    });
    await changedRow(row.op, []);
    return { kind: "parked" };
  };

  // a sent row's op computed again; no write joins a sent row, so the pass alone changes it
  const resend = async (
    row: OutboxRow,
    op: OutboxOp,
    overlapped: readonly string[],
  ): Promise<SendOutcome> => {
    const next: OutboxRow = { ...row, op };
    await hold(async () => {
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, saveRow(next));
      });
      replace(next);
    });
    await changedRow(op, overlapped);
    return { kind: "again" };
  };

  // the row is retired in the transaction that lays what it landed. The cell holds the write
  // either way, so a landing this device cannot lay over the rows it holds (a row whose newer
  // change is still to come in its way) retires the row alone, and the pull after lays what the
  // cell holds: a row is never sent again for what only this device's copy refused. A make the
  // cell folded takes the rows naming it along, since the id they name will never exist
  const land = async (
    row: OutboxRow,
    work: () => SqlPlan<void>,
    touched: Touched,
    fold: Fold | null = null,
  ): Promise<SendOutcome> => {
    await hold(async () => {
      const followed =
        fold === null
          ? []
          : rows
              .filter((held) => held.seq !== row.seq && itemIdsOf(held.op).includes(fold.from))
              .map((held) => ({ held, op: repointedOp(held.op, fold.from, fold.to) }));
      const retire = function* retire(): SqlPlan<void> {
        yield* deleteRow(row.seq);
        yield* saveRewritten(followed);
      };
      try {
        await sql.exclusive(async (tx) => {
          await runPlanAsync(tx, retire());
          await runPlanAsync(tx, work());
        });
      } catch {
        await sql.exclusive(async (tx) => {
          await runPlanAsync(tx, retire());
        });
      }
      forget(row.seq);
      if (fold !== null) {
        folded.add(fold.from, fold.to);
      }
      await adopt(followed);
      await release(row.op);
    });
    for (const id of itemIdsOf(row.op)) {
      touched.ids.add(id);
    }
    touched.kinds.add("item");
    await context.changed(touched, rows);
    return { kind: "landed" };
  };

  // the cell holds what the row asked for already, or the row asked nothing of it
  const satisfied = async (row: OutboxRow): Promise<SendOutcome> =>
    await land(
      row,
      function* nothing() {
        yield* [];
      },
      touchedNothing(),
    );

  const landMake = async (
    row: OutboxRow,
    madeAs: string,
    item: LiveItemRow,
    written: readonly StoredBlock[],
  ): Promise<SendOutcome> =>
    await land(
      row,
      function* landed() {
        yield* landOwnRow(item, { dropped: [], written });
      },
      touchedItems([item.id]),
      madeAs === item.id ? null : { from: madeAs, to: item.id },
    );

  const settled = async <T>(
    row: OutboxRow,
    outcome: Settled<T>,
    again: (op: T) => OutboxOp,
    overlapped: readonly string[],
  ): Promise<SendOutcome> => {
    if (outcome.kind === "satisfied") {
      return await satisfied(row);
    }
    return await resend(row, again(outcome.op), overlapped);
  };

  // a refusal the procedure declares, or one every call shares
  const refused = async (
    row: OutboxRow,
    error: Error,
    own: () => Promise<SendOutcome | null>,
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
    return await refused(row, error, async () => {
      if (!isDefinedError(error)) {
        return null;
      }
      switch (error.code) {
        case "CONFLICT": {
          const { current } = error.data;
          // another item holding the address this write leaves: no base answers that, so the
          // cell's words are the person's
          if (current.some((met) => met.kind === "item" && met.itemId !== op.itemId)) {
            return null;
          }
          return await (async () => {
            const outcome = await settleWrite(op, current, {
              merge: context.merge,
              newId: context.newId,
            });
            const overlapped = outcome.kind === "resend" && outcome.overlapped;
            return await settled(row, outcome, (again) => again, overlapped ? [op.itemId] : []);
          })();
        }
        case "BLOB_MISSING": {
          return await missingFiles(row, error.data.shas);
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
      const elsewhere = "folded" in answer && answer.folded === true;
      const written = elsewhere ? [] : [...madeBy(op).blocks.values()];
      return await landMake(row, op.input.id, answer.item, written);
    }
    return await refused(row, error, async () => {
      if (!isDefinedError(error)) {
        return null;
      }
      if (error.code === "BLOB_MISSING" && "shas" in error.data) {
        return await missingFiles(row, error.data.shas);
      }
      // the id is minted for this row alone, so an item under it is this row's, landed under an
      // op id the cell has since let go; the pull lays it
      return error.code === "CONFLICT" &&
        "current" in error.data &&
        error.data.current.some(
          (current) => current.kind === "item" && current.itemId === op.input.id,
        )
        ? await satisfied(row)
        : null;
    });
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
      return await refused(row, error, async () => await Promise.resolve(null));
    }
    // the cell keeps this answer under the row's op id, so what it left goes again under a new one;
    // what it did restore stands once the pull brings it
    if ("restored" in answer && answer.addressHeld.length > 0) {
      const ids = answer.addressHeld;
      return await park(row, ADDRESS_HELD, {
        op: { ids, kind: "restore" },
        opId: context.newId(),
      });
    }
    const changed = "deleted" in answer ? answer.deleted : answer.restored;
    return await land(
      row,
      function* landed() {
        yield* op.kind === "delete" ? markDeleted(changed, row.createdAt) : markRestored(changed);
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
    return await refused(row, error, async () => {
      if (!isDefinedError(error) || error.code !== "CONFLICT") {
        return null;
      }
      const outcome = settleFolders(op.ops, error.data.current);
      return outcome.kind === "refused"
        ? await park(row, outcome.reason)
        : await settled(row, outcome, (ops) => ({ kind: "folders", ops }), []);
    });
  };

  // pinned before it first goes, so every resend is the call that went: the row as it stands once
  // the hold is had, which a write may have joined since the pass chose it, or null once a join
  // left nothing of it
  const pin = async (seq: number): Promise<OutboxRow | null> =>
    await hold(async () => {
      const row = rows.find((candidate) => candidate.seq === seq);
      if (row?.state !== "queued") {
        return row ?? null;
      }
      const pinned: OutboxRow = { ...row, state: "sent" };
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, saveRow(pinned));
      });
      replace(pinned);
      return pinned;
    });

  // an op computed under an id that folded since, as the rows queued then were followed, so a write
  // past its check never parks on an id no item will hold; null where it names nothing else
  const followFolds = (op: OutboxOp): OutboxOp | null => {
    let followed: OutboxOp | null = op;
    for (const id of itemIdsOf(op)) {
      const holder = folded.landedAs(id);
      if (followed !== null && holder !== id) {
        followed = repointedOp(followed, id, holder);
      }
    }
    return followed;
  };

  // a write joins the last row naming its item, a delete or a restore of several included, so it
  // joins only a write nothing on its item has queued behind, only one no pin has sent, and only one
  // it would not carry ahead of a folder it files in
  const queue = async (
    given: OutboxOp,
    files: readonly StagedBytes[],
    createdAt: number,
  ): Promise<void> => {
    for (const file of files) {
      await blobs.put(file.sha, file.bytes, file.mime);
    }
    const op = withKeptFiles(given, rows);
    const last =
      op.kind === "write"
        ? rows.findLast((row) => itemIdsOf(row.op).includes(op.itemId))
        : undefined;
    if (
      op.kind !== "write" ||
      last?.state !== "queued" ||
      last.op.kind !== "write" ||
      filesAheadOf(op, last, rows)
    ) {
      const row = await sql.exclusive(
        async (tx) => await runPlanAsync(tx, insertRow({ createdAt, op, opId: context.newId() })),
      );
      rows = [...rows, row];
      return;
    }
    const joined = coalesceWrites(last.op, op);
    if (joined.ops.length === 0 && joined.annotations.length === 0) {
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, deleteRow(last.seq));
      });
      forget(last.seq);
      await release(joined);
      return;
    }
    const next: OutboxRow = { ...last, op: joined };
    await sql.exclusive(async (tx) => {
      await runPlanAsync(tx, saveRow(next));
    });
    replace(next);
  };

  const send = async (chosen: OutboxRow): Promise<SendOutcome> => {
    const row = await pin(chosen.seq);
    if (row === null) {
      return { kind: "gone" };
    }
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
      // its file is up, which was all it asked
      case "keep": {
        return await satisfied(row);
      }
      // no default
    }
  };

  return {
    discard: async (seq) => {
      const touched = await hold(async () => {
        const row = rows.find((candidate) => candidate.seq === seq);
        if (row?.state !== "parked") {
          return null;
        }
        // a folder let go is an id the cell will never hold, so nothing queued may go on naming it
        const gone = new Set(foldersMadeBy(row.op));
        const named = (op: OutboxOp): boolean =>
          [...holdsOf(op), ...foldersFiledIn(op)].some((id) => gone.has(id));
        const unfiled = rows
          .filter((held) => held.seq !== seq && named(held.op))
          .map((held) => ({ held, op: unfiledOp(held.op, gone) }));
        await sql.exclusive(async (tx) => {
          await runPlanAsync(tx, deleteRow(seq));
          await runPlanAsync(tx, saveRewritten(unfiled));
        });
        forget(seq);
        await adopt(unfiled);
        await release(row.op);
        return touchedItems([row.op, ...unfiled.map(({ held }) => held.op)].flatMap(itemIdsOf));
      });
      if (touched !== null) {
        touched.kinds.add("folder");
        await context.changed(touched, rows);
      }
    },

    drain: async () => {
      // how often this pass has sent each row, and what it held the last time it went
      const rounds = new Map<number, { readonly count: number; readonly op: OutboxOp }>();
      for (let sent = 0; sent < MAX_ROWS_PER_PASS; sent += 1) {
        if (!context.live()) {
          return { kind: "closed" };
        }
        const row = nextToSend(rows);
        if (row === null) {
          return { kind: "caught-up" };
        }
        const last = rounds.get(row.seq);
        const count = (last?.count ?? 0) + 1;
        if (last !== undefined && count > MAX_ROUNDS_PER_ROW) {
          if (!sameJson(last.op, row.op)) {
            return { failure: { kind: "unreachable", message: KEPT_CHANGING }, kind: "stopped" };
          }
          await park(row, CHANGE_REFUSED);
          continue;
        }
        rounds.set(row.seq, { count, op: row.op });
        const outcome = await send(row);
        if (outcome.kind === "stopped" || outcome.kind === "closed") {
          return outcome;
        }
      }
      return { kind: "more" };
    },

    enqueue: async (given, files) => {
      const createdAt = context.clock.now();
      const queued = await hold(async () => {
        // under the hold, which a wipe takes too: a write past this check is one the wipe removes
        if (!context.live()) {
          throw new ReplicaClosedError();
        }
        const op = followFolds(given);
        if (op !== null) {
          await queue(op, files, createdAt);
        }
        return op;
      });
      if (queued !== null) {
        await changedRow(queued, []);
      }
    },

    load: async () => {
      await hold(async () => {
        rows = await runPlanAsync(sql, readRows());
      });
    },

    retry: async (seq) => {
      const row = await hold(async () => {
        const held = rows.find((candidate) => candidate.seq === seq);
        if (held?.state !== "parked") {
          return null;
        }
        // it may have gone before it parked, so it goes again as it went
        const next: OutboxRow = { ...held, reason: null, state: "sent" };
        await sql.exclusive(async (tx) => {
          await runPlanAsync(tx, saveRow(next));
        });
        replace(next);
        return next;
      });
      if (row !== null) {
        await changedRow(row.op, []);
      }
    },

    rows: () => rows,

    wipe: async () => {
      await hold(async () => {
        rows = [];
        uploaded.clear();
        await sql.exclusive(async (tx) => {
          await runPlanAsync(tx, deleteAllRows());
        });
        await blobs.clear();
      });
    },
  };
};
