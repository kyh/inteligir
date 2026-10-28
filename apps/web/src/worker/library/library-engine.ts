// The library cell's engine: every rule over the account's library, as synchronous calls over the
// cell's SQLite, each write one `transactionSync`. It holds no state of its own, so the Durable
// Object opens it per call over its storage, and a test opens it over the same storage with its
// own clock. A write takes the library's next sequence number once, stamps every row it touches
// and the change log with it, joins its actor's change set, and keeps its answer under its `opId`
// for 30 days, so an outbox resending after a lost answer is told what landed.

import type { annotationOpSchema } from "@repo/contract/cloud/library/library-wire";
import { liveItemRowSchema } from "@repo/contract/cloud/library/library-wire";
import { blockHash } from "@repo/notes/library/block-hash";
import { applyOps } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import {
  nextHead,
  readItem,
  readItemState,
  readMeta,
  recordChanges,
  storeTombstone,
  writeMeta,
} from "@repo/notes/library/library-queries";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import { LibraryRowError, runPlan } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { annotationSourceOf } from "./cell-actor";
import type { CellActor } from "./cell-actor";
import { applyAnnotationOps, readAnnotationRow, readAnnotationRows } from "./cell-annotations";
import {
  beginRemoval,
  blobRemovals,
  dropItemBlobs,
  endRemoval,
  itemBlobShas,
  refuseUpload,
  releaseUpload,
  reserveUpload,
  settleUpload,
} from "./cell-blobs";
import type { StoredObject, UploadRequest, UploadRoom } from "./cell-blobs";
import { dueJobs, ensureJob, nextJobAt, retryJob, scheduleJob } from "./cell-jobs";
import type { DueJob } from "./cell-jobs";
import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { blockContents, readFieldsPart, readManifest } from "./cell-parts";
import { refuse, RefusedWriteError } from "./cell-refusal";
import type { CellResult, ConflictCurrent } from "./cell-refusal";
import type { CellStorage } from "./cell-storage";
import { libraryHead, pullChanges, readBodies } from "./cell-sync";
import type { BodiesAnswer, PullAnswer } from "./cell-sync";
import { undoChangeSets } from "./cell-undo";
import type { UndoAnswer } from "./cell-undo";
import { joinChangeSet, openUndoSet, PRUNE_JOB, sealChangeSet } from "./change-sets";
import type { OpenSet } from "./change-sets";
import { PRUNE_EVERY_MS, pruneHistory } from "./history-prune";

type AnnotationOp = z.infer<typeof annotationOpSchema>;

export interface LibraryEngineDeps {
  readonly storage: CellStorage;
  readonly now: () => number;
  // a change set's id
  readonly newId: () => string;
  readonly bytesCap: number;
}

export interface LandedItem {
  readonly item: LiveItemRow;
}

export interface CreateItemInput {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly {
    readonly block: LibraryBlock;
    readonly ord: string;
    readonly section: LibrarySection;
  }[];
  readonly opId?: string | undefined;
}

export interface WriteItemInput {
  readonly itemId: string;
  readonly ops: readonly LibraryOp[];
  readonly annotations?: readonly AnnotationOp[] | undefined;
  readonly opId?: string | undefined;
}

export interface PurgeItemsInput {
  readonly ids: readonly string[];
  readonly opId?: string | undefined;
}

export interface PurgedItems {
  readonly missing: readonly string[];
  readonly purged: readonly string[];
}

export interface UndoInput {
  readonly changeSetIds: readonly string[];
  readonly opId?: string | undefined;
}

export interface RevisionAnswer {
  readonly blocks: readonly StoredBlock[];
  readonly fields: LibraryItemFields;
  readonly rev: number;
}

export interface UploadSettlement {
  readonly settled: boolean;
}

// a stray file whose removal from R2 has begun
export interface StrayRemoval {
  readonly job: DueJob<"stray">;
  readonly sha: string;
}

const landedSchema = z.object({ item: liveItemRowSchema });
const purgedSchema = z.object({ missing: z.array(z.string()), purged: z.array(z.string()) });
const undoSchema = z.object({
  changeSetId: z.string(),
  kept: z.array(z.string()),
  reverted: z.array(z.string()),
});

const answerRowSchema = z.object({ answer: z.string() });
const deletedAtSchema = z.number().int().nonnegative();
const revisionRowSchema = z.object({ fields: z.string(), manifest: z.string() });

type OpConflict = Extract<ReturnType<typeof applyOps>, { kind: "conflict" }>["conflicts"][number];

const conflictCurrentOf = (itemId: string, conflict: OpConflict): ConflictCurrent => {
  switch (conflict.kind) {
    case "block": {
      return { blockId: conflict.blockId, current: conflict.current, itemId, kind: "block" };
    }
    case "order": {
      return { blockId: conflict.blockId, currentOrd: conflict.currentOrd, itemId, kind: "order" };
    }
    case "field": {
      return {
        current: z.json().parse(conflict.current),
        field: conflict.field,
        itemId,
        kind: "field",
      };
    }
    case "property": {
      return conflict.current === undefined
        ? { itemId, key: conflict.key, kind: "property" }
        : {
            current: z.json().parse(conflict.current),
            itemId,
            key: conflict.key,
            kind: "property",
          };
    }
    // no default
  }
};

const placedState = (fields: LibraryItemFields, blocks: CreateItemInput["blocks"]): ItemState => ({
  blocks: new Map(
    blocks.map(({ block, ord, section }) => [
      block.id,
      { block, hash: blockHash(block), ord, section },
    ]),
  ),
  fields,
});

const JSON_TEXT = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

const PAYLOADS = {
  prune: JSON_TEXT.pipe(z.object({ after: z.string().nullable() })),
  seal: JSON_TEXT.pipe(z.object({ changeSetId: z.string() })),
  stray: JSON_TEXT.pipe(z.object({ sha: z.string() })),
  upload: JSON_TEXT.pipe(z.object({ sha: z.string() })),
};

// the jobs a run settles inside one transaction each; a stray's removal waits on R2, so the cell
// runs it between two (`removeStrays` in `./cell-library`)
const STORAGE_JOBS = ["seal", "prune", "upload"] as const;

const PRUNE_AGAIN_MS = 1000;

// what a write took on its first landing: the library's next sequence number and its actor's set
interface Taken {
  seq: number | null;
  set: OpenSet | null;
}

// a write that lands in no change set: a file's room, a purge
const noSet = (): OpenSet => {
  throw new LibraryRowError("this write joins no change set");
};

export const openLibraryEngine = (deps: LibraryEngineDeps) => {
  const { bytesCap, newId, storage } = deps;

  const deletedAt = (): number | null => {
    const held = runPlan(storage, readMeta("deleted_at"));
    return held === null ? null : deletedAtSchema.parse(held);
  };

  // one write: refused once the account is being deleted, answered from its op's record when it
  // already landed, else run whole or not at all
  const transact = <T>(
    request: {
      readonly opId: string | undefined;
      readonly answer: z.ZodType<T>;
      readonly openSet: (now: number) => OpenSet;
    },
    work: (scope: LandingScope) => T,
  ): CellResult<T> => {
    try {
      return storage.transaction((): CellResult<T> => {
        if (deletedAt() !== null) {
          refuse({ kind: "gone" });
        }
        const now = deps.now();
        if (request.opId !== undefined) {
          const [prior] = storage.all("SELECT answer FROM applied_ops WHERE op_id = ?", [
            request.opId,
          ]);
          if (prior !== undefined) {
            const answer = JSON_TEXT.parse(answerRowSchema.parse(prior).answer);
            return { head: null, ok: true, value: request.answer.parse(answer) };
          }
        }
        const taken: Taken = { seq: null, set: null };
        const scope: LandingScope = {
          bytesCap,
          now,
          seq: () => {
            taken.seq ??= runPlan(storage, nextHead());
            return taken.seq;
          },
          set: () => {
            taken.set ??= request.openSet(now);
            return taken.set;
          },
          storage,
        };
        const value = work(scope);
        const joined = taken.set;
        if (joined !== null && joined.policy.kind === "commit") {
          sealChangeSet(storage, joined.id, now);
        }
        if (request.opId !== undefined) {
          storage.run(
            "INSERT INTO applied_ops (op_id, change_set_id, answer, at) VALUES (?, ?, ?, ?)",
            [request.opId, joined?.id ?? null, JSON.stringify(value), now],
          );
          ensureJob(storage, PRUNE_JOB, now + PRUNE_EVERY_MS);
        }
        return { head: taken.seq, ok: true, value };
      });
    } catch (error) {
      if (error instanceof RefusedWriteError) {
        return { ok: false, refusal: error.refusal };
      }
      throw error;
    }
  };

  const joining = (actor: CellActor) => (now: number) => joinChangeSet(storage, actor, now, newId);

  const create = (actor: CellActor, input: CreateItemInput): CellResult<LandedItem> =>
    transact({ answer: landedSchema, openSet: joining(actor), opId: input.opId }, (scope) => {
      const held = runPlan(storage, readItem(input.id));
      if (held !== null) {
        refuse({ current: [{ itemId: input.id, kind: "item", seq: held.seq }], kind: "conflict" });
      }
      return {
        item: landItem(scope, {
          after: placedState(input.fields, input.blocks),
          annotations: { changed: new Set(), rows: new Map() },
          before: null,
          itemId: input.id,
        }),
      };
    });

  const write = (actor: CellActor, input: WriteItemInput): CellResult<LandedItem> =>
    transact({ answer: landedSchema, openSet: joining(actor), opId: input.opId }, (scope) => {
      const { itemId } = input;
      const state = runPlan(storage, readItemState(itemId));
      if (state === null) {
        return refuse({ kind: "not-found" });
      }
      const outcome = applyOps(state, input.ops);
      const rows = readAnnotationRows(storage, itemId);
      const highlights = applyAnnotationOps(rows, input.annotations ?? [], {
        itemId,
        nowSeconds: Math.floor(scope.now / 1000),
        readRow: (id) => readAnnotationRow(storage, id),
        source: annotationSourceOf(actor),
      });
      const conflicts = [
        ...(outcome.kind === "conflict"
          ? outcome.conflicts.map((conflict) => conflictCurrentOf(itemId, conflict))
          : []),
        ...highlights.conflicts,
      ];
      if (conflicts.length > 0) {
        refuse({ current: conflicts, kind: "conflict" });
      }
      if (outcome.kind !== "applied") {
        return refuse({ kind: "too-large" });
      }
      const { touched } = outcome;
      const unchanged =
        touched.blocks.size === 0 &&
        touched.dropped.size === 0 &&
        !touched.fields &&
        highlights.landed.changed.size === 0;
      if (!unchanged) {
        return {
          item: landItem(scope, {
            after: outcome.state,
            annotations: highlights.landed,
            before: { rows, state },
            itemId,
          }),
        };
      }
      // every op was already true: the row as it stands
      const item = runPlan(storage, readItem(itemId));
      if (item?.kind !== "live") {
        return refuse({ kind: "not-found" });
      }
      const { card, fields, seq, updatedAt } = item;
      return { item: { card, fields, id: itemId, kind: "live", seq, updatedAt } };
    });

  // emptying Deleted: the item keeps its id and sequence as a tombstone, and its body, highlights
  // and history go; it joins no set, since nothing can take it back
  const purgeItems = (input: PurgeItemsInput): CellResult<PurgedItems> =>
    transact({ answer: purgedSchema, openSet: noSet, opId: input.opId }, (scope) => {
      const purged: string[] = [];
      const missing: string[] = [];
      for (const id of new Set(input.ids)) {
        const item = runPlan(storage, readItem(id));
        if (item?.kind !== "live" || item.fields.deletedAt === null) {
          missing.push(id);
          continue;
        }
        const seq = scope.seq();
        const highlights = [...readAnnotationRows(storage, id).keys()];
        const shas = itemBlobShas(storage, id);
        runPlan(
          storage,
          storeTombstone({ deletedAt: item.fields.deletedAt, id, seq, updatedAt: scope.now }),
        );
        dropItemBlobs(storage, id, shas);
        for (const table of [
          "revisions",
          "snapshot_parts",
          "block_versions",
          "change_set_items",
        ] as const) {
          storage.run(`DELETE FROM ${table} WHERE item_id = ?`, [id]);
        }
        runPlan(
          storage,
          recordChanges([
            { gone: false, id, kind: "item", seq },
            ...highlights.map((annotation) => ({
              gone: true,
              id: annotation,
              kind: "annotation" as const,
              seq,
            })),
          ]),
        );
        purged.push(id);
      }
      return { missing, purged };
    });

  const undo = (requester: CellActor, input: UndoInput): CellResult<UndoAnswer> =>
    transact(
      {
        answer: undoSchema,
        openSet: (now) => openUndoSet(storage, requester, now, newId),
        opId: input.opId,
      },
      (scope) => undoChangeSets(scope, input.changeSetIds),
    );

  // an agent's turn or an import closes its own set; false when it was closed already
  const closeChangeSet = (changeSetId: string): boolean =>
    storage.transaction(() => sealChangeSet(storage, changeSetId, deps.now()));

  // room for a file a device is about to upload
  const reserve = (request: UploadRequest): CellResult<UploadRoom> =>
    transact(
      { answer: z.object({ held: z.boolean() }), openSet: noSet, opId: undefined },
      (scope) => reserveUpload(storage, bytesCap, request, scope.now),
    );

  // the file's row once R2 holds it, at the size R2 reports, R2 read after `removalsSeen` was;
  // bytes past the quota go from R2 again
  const settle = (
    sha: string,
    stored: StoredObject | null,
    removalsSeen: number,
  ): CellResult<UploadSettlement> => {
    const result = transact(
      { answer: z.object({ settled: z.boolean() }), openSet: noSet, opId: undefined },
      (scope) => {
        const settled = settleUpload(storage, bytesCap, { removalsSeen, sha, stored });
        if (settled.landed) {
          const seq = scope.seq();
          runPlan(storage, recordChanges([{ gone: false, id: sha, kind: "blob", seq }]));
        }
        return { settled: settled.settled };
      },
    );
    if (!result.ok && result.refusal.kind === "quota") {
      storage.transaction(() => {
        refuseUpload(storage, sha, deps.now());
      });
    }
    return result;
  };

  // the strays whose removal is due, each begun unless a file row or an upload's room holds its
  // sha again
  const beginStrayRemovals = (): StrayRemoval[] =>
    storage.transaction(() =>
      dueJobs(storage, deps.now(), ["stray"]).flatMap((job) => {
        const { sha } = PAYLOADS.stray.parse(job.payload);
        return beginRemoval(storage, sha) ? [{ job, sha }] : [];
      }),
    );

  // the removals R2 took, or the ones it failed, which wait their turn again
  const endStrayRemovals = (removals: readonly StrayRemoval[], removed: boolean): void => {
    const now = deps.now();
    storage.transaction(() => {
      for (const removal of removals) {
        if (removed) {
          endRemoval(storage, removal.sha);
        } else {
          retryJob(storage, removal.job, now);
        }
      }
    });
  };

  // a read refused only once the account is being deleted
  const reading = <T>(read: () => T): CellResult<T> =>
    deletedAt() === null
      ? { head: null, ok: true, value: storage.transaction(read) }
      : { ok: false, refusal: { kind: "gone" } };

  const pull = (request: { readonly cursor: number; readonly epoch: string | null }) =>
    reading((): PullAnswer => pullChanges(storage, request));

  const bodies = (ids: readonly string[]) => reading((): BodiesAnswer => readBodies(storage, ids));

  // an item as one revision left it: History shows it, and a restore patches it back
  const revision = (itemId: string, rev: number): CellResult<RevisionAnswer | null> =>
    reading((): RevisionAnswer | null => {
      const [raw] = storage.all(
        "SELECT fields, manifest FROM revisions WHERE item_id = ? AND rev = ?",
        [itemId, rev],
      );
      if (raw === undefined) {
        return null;
      }
      const row = revisionRowSchema.parse(raw);
      const manifest = readManifest(storage, itemId, row.manifest);
      const contents = blockContents(storage, itemId, new Set(manifest.map((entry) => entry.hash)));
      const blocks = manifest.map((entry): StoredBlock => {
        const block = contents.get(entry.hash);
        if (block === undefined) {
          throw new LibraryRowError(`the block version ${entry.hash} a revision names is not kept`);
        }
        return { block, hash: entry.hash, ord: entry.ord, section: entry.section };
      });
      return { blocks, fields: readFieldsPart(storage, itemId, row.fields), rev };
    });

  const runJob = (job: DueJob<(typeof STORAGE_JOBS)[number]>, now: number): void => {
    switch (job.kind) {
      case "seal": {
        sealChangeSet(storage, PAYLOADS.seal.parse(job.payload).changeSetId, now);
        break;
      }
      case "upload": {
        releaseUpload(storage, PAYLOADS.upload.parse(job.payload).sha, now);
        break;
      }
      case "prune": {
        const next = pruneHistory(storage, now, PAYLOADS.prune.parse(job.payload).after);
        scheduleJob(
          storage,
          { ...PRUNE_JOB, payload: JSON.stringify({ after: next }) },
          next === null ? now + PRUNE_EVERY_MS : now + PRUNE_AGAIN_MS,
        );
        break;
      }
      // no default
    }
  };

  // what the alarm runs: every job due, each in its own transaction, so one that fails is tried
  // again later and the rest still run
  const runDueJobs = (onFailure: (job: DueJob, cause: unknown) => void): void => {
    const now = deps.now();
    for (const job of storage.transaction(() => dueJobs(storage, now, STORAGE_JOBS))) {
      try {
        storage.transaction(() => {
          runJob(job, now);
        });
      } catch (error) {
        onFailure(job, error);
        storage.transaction(() => {
          retryJob(storage, job, now);
        });
      }
    }
  };

  // the account's deletion has begun: every later write and read is refused
  const tombstone = (): void => {
    storage.transaction(() => {
      if (deletedAt() === null) {
        runPlan(storage, writeMeta("deleted_at", deps.now()));
      }
    });
  };

  return {
    beginStrayRemovals,
    blobRemovals: () => blobRemovals(storage),
    bodies,
    closeChangeSet,
    create,
    deletedAt,
    endStrayRemovals,
    head: () => libraryHead(storage),
    nextJobAt: () => nextJobAt(storage),
    pull,
    purgeItems,
    reserve,
    revision,
    runDueJobs,
    settle,
    tombstone,
    undo,
    write,
  };
};

export type LibraryEngine = ReturnType<typeof openLibraryEngine>;
