// The library cell's engine: what guards every transaction over the account's library, as
// synchronous calls over the cell's SQLite, and none of its rules, which are each module's own
// (`./cell-items`, `./cell-blobs`, `./cell-fills`, `./cell-notes`). Its one state is the listing it
// keeps (`./cell-listing`), so the cell opens it once a wake (`./open-cell`). A write takes the
// library's next sequence number once, stamps every row it touches with it, joins its actor's
// change set when it changes an item, and keeps its answer under its `opId` for 30 days, so a
// client resending after a lost answer is told what landed. What follows a commit is the engine's
// own, in the turn that committed it: the sockets told what it moved, the alarm set to the earliest
// job and each note whose item went into Deleted or came back told to reopen, so no caller settles
// a write.

import type { LibraryIndex, ListingRow } from "@repo/contract/library/library-index";
import type { MovedFrame } from "@repo/contract/library/library-socket";
import { nextHead, readCellState, writeCellState } from "./library-queries";
import type { CellDb } from "./cell-db";
import { jsonTextSchema } from "./sql-value";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { appliedOps } from "@repo/db/cell/schema";

import type { TurnUndone } from "../note/note-wire";
import type { CellActor } from "./cell-actor";
import type { CellIds } from "./cell-ids";
import { holdListing } from "./cell-listing";
import { ensureJob, nextJobAt } from "./cell-jobs";
import type { ItemScope, WriteScope } from "./cell-landing";
import { collectMoved } from "./cell-moved";
import type { MovedCollector } from "./cell-moved";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellResult } from "./cell-refusal";
import { undoChangeSets } from "./cell-undo";
import { joinChangeSet, openUndoSet, PRUNE_JOB, sealChangeSet } from "./change-sets";
import type { OpenSet } from "./change-sets";
import { PRUNE_EVERY_MS } from "./change-set-prune";

export interface LibraryEngineDeps {
  readonly db: CellDb;
  readonly now: () => number;
  // every id the cell mints: items, blocks, change sets
  readonly ids: CellIds;
  readonly bytesCap: number;
  // what follows every commit, in the turn that made it: what it moved, null for nothing a client
  // reads, when the earliest job waits, null for none, and the items it moved into or out of
  // Deleted whose notes are open
  readonly committed: (
    moved: MovedFrame | null,
    nextJobAt: number | null,
    reopens: readonly string[],
  ) => void;
}

// what a write asks of the engine around its work: its key in the op ledger, and the schema its
// answer is read through, as it lands and as the ledger kept it
export interface WriteRequest<S extends z.ZodType> {
  readonly opId: string | undefined;
  readonly answer: S;
}

// an answer as a write's work may build it: its lists read-only, which the answer's schema gives
// back as plain ones
export type Built<T> = T extends readonly (infer E)[]
  ? readonly Built<E>[]
  : T extends object
    ? { readonly [K in keyof T]: Built<T[K]> }
    : T;

export interface UndoInput {
  readonly changeSetIds: readonly string[];
  readonly opId?: string | undefined;
}

// what an undo's notes answered before its write, and the id its own set takes, which each note
// undid under
export interface NotesUndone {
  readonly undoSetId: string;
  readonly notes: ReadonlyMap<string, TurnUndone>;
}

const undoSchema = z.object({
  changeSetId: z.string().nullable(),
  kept: z.array(z.string()),
  lostText: z.array(z.string()),
  refused: z.array(z.string()),
  reverted: z.array(z.string()),
});

// the last sequence number a write took, 0 before the first
export const libraryHead = (db: CellDb): number => readCellState(db)?.head ?? 0;

// what a write took on its first landing: the library's next sequence number and the set it joined
interface Taken {
  seq: number | null;
  set: OpenSet | null;
}

// a transaction's value, or the refusal a rule threw inside it, which rolled it back
const answering = <T>(run: () => T): CellResult<T> => {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof RefusedWriteError) {
      return { ok: false, refusal: error.refusal };
    }
    throw error;
  }
};

export const openLibraryEngine = (deps: LibraryEngineDeps) => {
  const { bytesCap, db, ids } = deps;
  const listing = holdListing();

  const deletedAt = (): number | null => readCellState(db)?.deletedAt ?? null;

  // Every transaction that may write, and what follows it with no await between: the sockets told
  // what it moved, the alarm set to the earliest job. Once the deletion began no job runs, so one
  // a failed step left sets no alarm; the deletion's retry wipes it
  const commit = <T>(work: (moved: MovedCollector) => T): T => {
    const moved = collectMoved();
    const value = db.$client.transactionSync(() => work(moved));
    deps.committed(moved.frame(), deletedAt() === null ? nextJobAt(db) : null, moved.reopens());
    return value;
  };

  // every transaction but the tombstone's own is refused once the account is being deleted
  const live = (): void => {
    if (deletedAt() !== null) {
      refuse({ kind: "gone" });
    }
  };

  // what the op answered when it landed, or null while it has not
  const priorAnswer = <S extends z.ZodType>(opId: string, answer: S): z.output<S> | null => {
    const prior = db
      .select({ answer: appliedOps.answer })
      .from(appliedOps)
      .where(eq(appliedOps.opId, opId))
      .get();
    return prior === undefined ? null : answer.parse(jsonTextSchema.parse(prior.answer));
  };

  // one write: answered from its op's record when it already landed, else run whole or not at all
  const transact = <S extends z.ZodType>(
    request: WriteRequest<S>,
    work: (scope: WriteScope, taken: Taken) => Built<z.input<S>>,
  ): CellResult<z.output<S>> =>
    answering(() =>
      commit((moved): z.output<S> => {
        live();
        const now = deps.now();
        const prior = request.opId === undefined ? null : priorAnswer(request.opId, request.answer);
        if (prior !== null) {
          return prior;
        }
        const taken: Taken = { seq: null, set: null };
        const scope: WriteScope = {
          // a nested transaction is a savepoint, so a refused part rolls back alone, and what it
          // took of the write's sequence or set rolled back with it, to be taken again
          attempt: (part) => {
            const before = { ...taken };
            const landed = answering(() => db.$client.transactionSync(part));
            if (!landed.ok) {
              taken.seq = before.seq;
              taken.set = before.set;
            }
            return landed;
          },
          bytesCap,
          db,
          moved,
          now,
          seq: () => {
            taken.seq ??= nextHead(db);
            return taken.seq;
          },
        };
        const value = request.answer.parse(work(scope, taken));
        if (taken.set?.policy.kind === "commit") {
          sealChangeSet(db, taken.set.id, now);
        }
        if (request.opId !== undefined) {
          db.insert(appliedOps)
            .values({ answer: JSON.stringify(value), at: now, opId: request.opId })
            .run();
          ensureJob(db, PRUNE_JOB, now + PRUNE_EVERY_MS);
        }
        return value;
      }),
    );

  // a write that changes items, in the set `open` gives it on its first landing
  const inSet = <S extends z.ZodType>(
    request: WriteRequest<S>,
    open: (now: number) => OpenSet,
    work: (scope: ItemScope) => Built<z.input<S>>,
  ): CellResult<z.output<S>> =>
    transact(request, (scope, taken) =>
      work({
        ...scope,
        set: () => {
          taken.set ??= open(scope.now);
          return taken.set;
        },
      }),
    );

  // a write by `actor`, joining its change set
  const land = <S extends z.ZodType>(
    actor: CellActor,
    request: WriteRequest<S>,
    work: (scope: ItemScope) => Built<z.input<S>>,
  ): CellResult<z.output<S>> =>
    inSet(request, (now) => joinChangeSet(db, actor, now, ids.changeSet), work);

  // a write that joins no set, since Undo takes nothing of it back: a folder, a thread, a file's
  // room, a note's typing, a purge
  const landApart = <S extends z.ZodType>(
    request: WriteRequest<S>,
    work: (scope: WriteScope) => Built<z.input<S>>,
  ): CellResult<z.output<S>> => transact(request, (scope) => work(scope));

  // an undo, in a set of its own by whoever asked for it
  const undo = (requester: CellActor, input: UndoInput, undone: NotesUndone) =>
    inSet(
      { answer: undoSchema, opId: input.opId },
      (now) => openUndoSet(db, requester, now, () => undone.undoSetId),
      (scope) => undoChangeSets(scope, input.changeSetIds, undone.notes),
    );

  // the cell's own bookkeeping in one transaction, which takes no sequence number, joins no set
  // and keeps no answer: a job's row, a note's socket, a seed handed over
  const rows = <T>(work: (cell: CellDb, now: number) => T): CellResult<T> =>
    answering(() =>
      commit(() => {
        live();
        return work(db, deps.now());
      }),
    );

  // a read, refused once the account is being deleted, or by its own rules (a cursor this library
  // never gave, an id naming nothing)
  const reading = <T>(work: () => T): CellResult<T> =>
    answering(() => {
      live();
      return db.$client.transactionSync(work);
    });

  const read = <T>(work: (cell: CellDb) => T): CellResult<T> => reading(() => work(db));

  // a read over the listing, caught up to the library's head
  const readListing = <T>(
    work: (index: LibraryIndex<ListingRow>, cell: CellDb) => T,
  ): CellResult<T> => reading(() => work(listing(db, libraryHead(db)), db));

  // what a write already answered under `opId`, or null while none has: a write whose work waits on
  // the network between its transactions asks first, and lands its op with its last one
  const answered = <S extends z.ZodType>(
    opId: string | undefined,
    answer: S,
  ): CellResult<z.output<S> | null> =>
    reading(() => (opId === undefined ? null : priorAnswer(opId, answer)));

  // the account's deletion has begun: every later write and read is refused
  const tombstone = (): void => {
    commit(() => {
      if (deletedAt() === null) {
        writeCellState(db, { deletedAt: deps.now() });
      }
    });
  };

  return { answered, deletedAt, ids, land, landApart, read, readListing, rows, tombstone, undo };
};

export type LibraryEngine = ReturnType<typeof openLibraryEngine>;
