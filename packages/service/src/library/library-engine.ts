// The library cell's engine: every rule over the account's library, as synchronous calls over the
// cell's SQLite, each write one `transactionSync`. Its one state is the listing it keeps
// (`./cell-listing`), so the cell opens it once a wake (`./open-cell`). A write takes the library's
// next sequence number once, stamps every row it touches with it, joins its turn's change set when
// the built-in agent made it, and keeps its answer under its `opId` for 30 days, so a client
// resending after a lost answer is told what landed. What follows a commit is the engine's own, in
// the turn that committed it: the sockets told what it moved, the alarm set to the earliest job and
// each note whose item went into Deleted or came back told to reopen, so no caller settles a write.

import type { LibraryIndex, ListingRow } from "@repo/contract/library/library-index";
import type { MovedFrame } from "@repo/contract/library/library-socket";
import { liveItemRowSchema } from "@repo/contract/library/library-wire";
import {
  nextHead,
  readCount,
  readInstant,
  readItem,
  storeTombstone,
  writeMeta,
} from "./library-queries";
import type { CellDb } from "./cell-db";
import { jsonTextSchema } from "./sql-value";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { appliedOps, changeSetItems } from "@repo/db/cell/schema";

import { fillLandedSchema } from "../fill/fill-landing";
import type { FillLanding } from "../fill/fill-landing";
import type { NoteOpening, NoteProjection, ProjectAnswer, SeedAnswer } from "../note/note-wire";
import type { CellActor, TurnActor } from "./cell-actor";
import {
  awaitNameAgain,
  beginRemoval,
  blobRemovals,
  dropItemBlobs,
  endRemoval,
  hurryUnnamed,
  refuseUpload,
  releaseUnnamed,
  releaseUpload,
  reserveUpload,
  settleUpload,
} from "./cell-blobs";
import type { StoredObject, UploadRequest, UploadRoom } from "./cell-blobs";
import { bodyWriter } from "./cell-body";
import { claimFills, FILL_ACTOR, fillWaits, landFill, readingFiles, sentFills } from "./cell-fills";
import type { ClaimedFill } from "./cell-fills";
import type { CellIds } from "./cell-ids";
import { holdListing } from "./cell-listing";
import { importsRunning } from "./cell-import-jobs";
import {
  deferJob,
  dropJob,
  dueJobs,
  ensureJob,
  nextJobAt,
  retryJob,
  scheduleJob,
} from "./cell-jobs";
import type { DueJob } from "./cell-jobs";
import type { LandingScope } from "./cell-landing";
import { collectMoved } from "./cell-moved";
import type { MovedCollector } from "./cell-moved";
import {
  forgetNoteSockets,
  landProjection,
  openNote,
  readSeed,
  takeSessionNotes,
} from "./cell-notes";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellResult } from "./cell-refusal";
import { landPropertyOps } from "./cell-writes";
import type { PropertyWrite } from "./cell-writes";
import { joinTurnSet, PRUNE_EVERY_MS, PRUNE_JOB } from "./change-sets";
import { pruneChangeSets } from "./change-set-prune";

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

export type WriteItemInput = PropertyWrite & { readonly opId?: string | undefined };

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

export interface PurgeItemsInput {
  readonly ids: readonly string[];
  readonly opId?: string | undefined;
}

// a purged item's note, emptied by the alarm between two transactions
export interface NotePurge {
  readonly job: DueJob<"note-purge">;
  readonly itemId: string;
}

export interface UploadSettlement {
  readonly settled: boolean;
}

// a stray file whose removal from R2 has begun
export interface StrayRemoval {
  readonly job: DueJob<"stray">;
  readonly sha: string;
}

export const landedSchema = z.object({ item: liveItemRowSchema });
const purgedSchema = z.object({ missing: z.array(z.string()), purged: z.array(z.string()) });
const projectAnswerSchema = z.enum(["landed", "stale", "gone"]);

// the last sequence number a write took, 0 before the first
export const libraryHead = (db: CellDb): number => readCount(db, "head");

// the jobs a run settles inside one transaction each; a stray's removal waits on R2, so the cell
// runs it between two (`removeStrays` in `./cell-library`)
const STORAGE_JOBS = ["prune", "upload", "unnamed"] as const;

const PRUNE_AGAIN_MS = 1000;
// a note's purge the alarm could not reach is asked again this long after
const NOTE_PURGE_AGAIN_MS = 60_000;
// a file no item names is asked about again this long after, while an import may yet name it
const PLAN_AGAIN_MS = 10 * 60_000;

// what a write took on its first landing: the library's next sequence number and its turn's set
interface Taken {
  seq: number | null;
  set: string | null;
}

export const openLibraryEngine = (deps: LibraryEngineDeps) => {
  const { bytesCap, db, ids } = deps;
  const listing = holdListing();

  const deletedAt = (): number | null => readInstant(db, "deleted_at");

  // Every transaction that may write, and what follows it with no await between: the sockets told
  // what it moved, the alarm set to the earliest job. Once the deletion began no job runs, so one
  // a failed step left sets no alarm; the deletion's retry wipes it
  const commit = <T>(work: (moved: MovedCollector) => T): T => {
    const moved = collectMoved();
    const value = db.$client.transactionSync(() => work(moved));
    deps.committed(moved.frame(), deletedAt() === null ? nextJobAt(db) : null, moved.reopens());
    return value;
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

  // one write: refused once the account is being deleted, answered from its op's record when it
  // already landed, else run whole or not at all
  const transact = <S extends z.ZodType>(
    request: WriteRequest<S> & { readonly turn: TurnActor | null },
    work: (scope: LandingScope) => Built<z.input<S>>,
  ): CellResult<z.output<S>> => {
    try {
      return commit((moved): CellResult<z.output<S>> => {
        if (deletedAt() !== null) {
          refuse({ kind: "gone" });
        }
        const now = deps.now();
        const prior = request.opId === undefined ? null : priorAnswer(request.opId, request.answer);
        if (prior !== null) {
          return { ok: true, value: prior };
        }
        const taken: Taken = { seq: null, set: null };
        const scope: LandingScope = {
          bytesCap,
          moved,
          now,
          seq: () => {
            taken.seq ??= nextHead(db);
            return taken.seq;
          },
          set: () => {
            const { turn } = request;
            if (turn === null) {
              return null;
            }
            taken.set ??= joinTurnSet(db, turn, ids.changeSet);
            return taken.set;
          },
          db,
        };
        const value = request.answer.parse(work(scope));
        if (request.opId !== undefined) {
          db.insert(appliedOps)
            .values({ answer: JSON.stringify(value), at: now, opId: request.opId })
            .run();
          ensureJob(db, PRUNE_JOB, now + PRUNE_EVERY_MS);
        }
        return { ok: true, value };
      });
    } catch (error) {
      if (error instanceof RefusedWriteError) {
        return { ok: false, refusal: error.refusal };
      }
      throw error;
    }
  };

  // a write by `actor`, joining its turn's change set when it is the built-in agent's
  const land = <S extends z.ZodType>(
    actor: CellActor,
    request: WriteRequest<S>,
    work: (scope: LandingScope) => Built<z.input<S>>,
  ): CellResult<z.output<S>> =>
    transact({ ...request, turn: actor.kind === "agent" ? actor : null }, work);

  // a write no turn made, so no change set keeps: a folder, a thread, a purge, an undo, a file's
  // room
  const landApart = <S extends z.ZodType>(
    request: WriteRequest<S>,
    work: (scope: LandingScope) => Built<z.input<S>>,
  ): CellResult<z.output<S>> => transact({ ...request, turn: null }, work);

  const write = (actor: CellActor, input: WriteItemInput) =>
    land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
      item: landPropertyOps(scope, input),
    }));

  // emptying Deleted: the item keeps its id and sequence as a tombstone, its body and every change
  // set's hold on it go, and the alarm lets go the files nothing else names
  const purgeItems = (input: PurgeItemsInput) =>
    landApart({ answer: purgedSchema, opId: input.opId }, (scope) => {
      const purged: string[] = [];
      const missing: string[] = [];
      for (const id of new Set(input.ids)) {
        const item = readItem(db, id);
        if (item?.kind !== "live" || item.fields.deletedAt === null) {
          missing.push(id);
          continue;
        }
        const seq = scope.seq();
        storeTombstone(db, {
          deletedAt: item.fields.deletedAt,
          id,
          seq,
          updatedAt: scope.now,
        });
        db.delete(changeSetItems).where(eq(changeSetItems.itemId, id)).run();
        dropItemBlobs(db, id, scope.now);
        forgetNoteSockets(db, id);
        if (bodyWriter(item.body.home) === "note") {
          scheduleJob(
            db,
            { id: `note-purge:${id}`, kind: "note-purge", payload: { itemId: id } },
            scope.now,
          );
        }
        scope.moved.item(id, seq);
        purged.push(id);
      }
      return { missing, purged };
    });

  // room for a file a device is about to upload
  const reserve = (request: UploadRequest): CellResult<UploadRoom> =>
    landApart({ answer: z.object({ held: z.boolean() }), opId: undefined }, (scope) =>
      reserveUpload(db, bytesCap, request, scope.now),
    );

  // the file's row once R2 holds it, at the size R2 reports, R2 read after `removalsSeen` was;
  // bytes past the quota go from R2 again
  const settle = (
    sha: string,
    stored: StoredObject | null,
    removalsSeen: number,
  ): CellResult<UploadSettlement> => {
    const result = landApart(
      { answer: z.object({ settled: z.boolean() }), opId: undefined },
      (scope) => ({
        settled: settleUpload(db, bytesCap, { removalsSeen, sha, stored }, scope.now),
      }),
    );
    if (!result.ok && result.refusal.kind === "quota") {
      commit(() => {
        refuseUpload(db, sha, deps.now());
      });
    }
    return result;
  };

  // the strays whose removal is due, each begun unless a file row or an upload's room holds its
  // sha again
  const beginStrayRemovals = (): StrayRemoval[] =>
    commit(() =>
      dueJobs(db, deps.now(), ["stray"]).flatMap((job) => {
        const { sha } = job.payload;
        return beginRemoval(db, sha) ? [{ job, sha }] : [];
      }),
    );

  // the removals R2 took, or the ones it failed, which wait their turn again
  const endStrayRemovals = (removals: readonly StrayRemoval[], removed: boolean): void => {
    const now = deps.now();
    commit(() => {
      for (const removal of removals) {
        if (removed) {
          endRemoval(db, removal.sha);
        } else {
          retryJob(db, removal.job, now);
        }
      }
    });
  };

  // the readings committed writes asked for, each put off a minute: its send's own time to land
  const claimDueFills = (): ClaimedFill[] => commit(() => claimFills(db, deps.now()));

  const fillsSent = (claimed: readonly ClaimedFill[]): void => {
    commit(() => {
      sentFills(db, claimed);
    });
  };

  // A page the cloud read, folded into the change set that made its item (`./cell-fills`); an
  // article its note already took lands as the note's projection. When the library would not take it, the alarm lets go at
  // once what it kept that no item names; a reading its note is yet to take lands again.
  const landReading = (landing: FillLanding, inNote: NoteProjection | null) => {
    const landed = land(FILL_ACTOR, { answer: fillLandedSchema, opId: undefined }, (scope) => {
      const filled = landFill(scope, landing, inNote !== null);
      if (inNote !== null) {
        landProjection(scope, landing.itemId, inNote);
      }
      return filled;
    });
    if (!landed.ok && landed.refusal.kind !== "gone" && landed.refusal.kind !== "note-opened") {
      commit(() => {
        hurryUnnamed(db, readingFiles(landing), deps.now());
      });
    }
    return landed;
  };

  // a read, refused once the account is being deleted, or by its own rules (a cursor this library
  // never gave, an id naming nothing)
  const reading = <T>(read: () => T): CellResult<T> => {
    if (deletedAt() !== null) {
      return { ok: false, refusal: { kind: "gone" } };
    }
    try {
      return { ok: true, value: db.$client.transactionSync(read) };
    } catch (error) {
      if (error instanceof RefusedWriteError) {
        return { ok: false, refusal: error.refusal };
      }
      throw error;
    }
  };

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

  const fillWanted = (itemId: string, url: string): CellResult<boolean> =>
    reading(() => fillWaits(db, itemId, url));

  const runJob = (job: DueJob<(typeof STORAGE_JOBS)[number]>, now: number): void => {
    switch (job.kind) {
      case "upload": {
        releaseUpload(db, job.payload.sha, now);
        break;
      }
      case "unnamed": {
        const { sha } = job.payload;
        if (importsRunning(db)) {
          awaitNameAgain(db, sha, now + PLAN_AGAIN_MS);
        } else {
          releaseUnnamed(db, [sha], now);
        }
        break;
      }
      case "prune": {
        const more = pruneChangeSets(db, now);
        scheduleJob(db, PRUNE_JOB, now + (more ? PRUNE_AGAIN_MS : PRUNE_EVERY_MS));
        break;
      }
      // no default
    }
  };

  // what the alarm runs: every job due, each in its own transaction, so one that fails is tried
  // again later and the rest still run
  const runDueJobs = (onFailure: (job: DueJob, cause: unknown) => void): void => {
    const now = deps.now();
    for (const job of commit(() => dueJobs(db, now, STORAGE_JOBS))) {
      try {
        commit(() => {
          runJob(job, now);
        });
      } catch (error) {
        onFailure(job, error);
        commit(() => {
          retryJob(db, job, now);
        });
      }
    }
  };

  // ---- what each item's note asks (`./cell-notes`) ----

  const noteOpening = (sessionId: string, itemId: string): NoteOpening =>
    commit(() => (deletedAt() === null ? openNote(db, sessionId, itemId) : "missing"));

  const seedFor = (itemId: string): SeedAnswer =>
    commit(() => (deletedAt() === null ? readSeed(db, itemId) : { kind: "missing" }));

  // a note's save, joining no change set: typing is no change Undo takes back
  const projectNote = (itemId: string, projection: NoteProjection): CellResult<ProjectAnswer> =>
    landApart({ answer: projectAnswerSchema, opId: undefined }, (scope) =>
      landProjection(scope, itemId, projection),
    );

  const sessionNotes = (sessionId: string): string[] =>
    commit(() => takeSessionNotes(db, sessionId));

  // the purged items' notes due to be emptied, each put off until it is reported done
  const claimNotePurges = (): NotePurge[] =>
    commit(() => {
      const now = deps.now();
      return dueJobs(db, now, ["note-purge"]).map((job) => {
        deferJob(db, job.id, now + NOTE_PURGE_AGAIN_MS);
        return { itemId: job.payload.itemId, job };
      });
    });

  const notePurged = (purge: NotePurge, done: boolean): void => {
    commit(() => {
      if (done) {
        dropJob(db, purge.job.id);
      } else {
        retryJob(db, purge.job, deps.now());
      }
    });
  };

  // the account's deletion has begun: every later write and read is refused
  const tombstone = (): void => {
    commit(() => {
      if (deletedAt() === null) {
        writeMeta(db, "deleted_at", deps.now());
      }
    });
  };

  return {
    answered,
    beginStrayRemovals,
    blobRemovals: () => blobRemovals(db),
    claimDueFills,
    claimNotePurges,
    deletedAt,
    endStrayRemovals,
    fillWanted,
    fillsSent,
    ids,
    land,
    landApart,
    landReading,
    noteOpening,
    notePurged,
    projectNote,
    purgeItems,
    read,
    readListing,
    reserve,
    runDueJobs,
    seedFor,
    sessionNotes,
    settle,
    tombstone,
    write,
  };
};

export type LibraryEngine = ReturnType<typeof openLibraryEngine>;
