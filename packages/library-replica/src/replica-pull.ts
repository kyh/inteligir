// The replica catching up with its cell: the change log after its cursor, a page at a time, each
// page laid in one transaction where every row lands only over an older one and the cursor moves
// with it, until the cell says there is no more; an answer naming another library wipes the rows,
// keeps the outbox and pulls from nothing. Then the bodies whose items moved, the one open on the
// screen first and the newest after, about 4 MB an answer, each laid only under the row it was
// sent for.

import { safe } from "@orpc/client";
import { BODY_IDS_MAX } from "@repo/contract/cloud/library/library-wire";
import type { V1Client } from "@repo/contract/cloud/v1";
import { readItem, storeItemBody } from "@repo/notes/library/library-queries";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import type { SqlPlan } from "@repo/notes/library/library-sql";

import { sharedFailure, UNREACHABLE } from "@repo/contract/cloud/library/call-outcome";
import type { CallFailure } from "@repo/contract/cloud/library/call-outcome";
import type { ReplicaSql } from "./replica-ports";
import {
  applyChange,
  dropWants,
  readSyncState,
  readWants,
  touchedNothing,
  wipeSynced,
  writeSyncState,
} from "./replica-rows";
import type { SyncState, Touched } from "./replica-rows";

type PullAnswer = Awaited<ReturnType<V1Client["library"]["sync"]["pull"]>>;
type ChangesAnswer = Extract<PullAnswer, { kind: "changes" }>;

export interface PullContext {
  readonly sql: ReplicaSql;
  readonly client: V1Client;
  // false once the replica is closed: an answer heard after lands nothing
  readonly live: () => boolean;
  // what a page or a reset laid, for the screens
  readonly landed: (touched: Touched, reset: boolean) => Promise<void>;
}

export type FetchOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly failure: CallFailure }
  | { readonly kind: "closed" };

// a library restored twice in one pull is a cell to ask again later
const MAX_RESETS = 2;

const failedWith = (error: Error): FetchOutcome => ({
  failure: sharedFailure(error) ?? { kind: "unreachable", message: UNREACHABLE },
  kind: "failed",
});

// one page over the rows, unless the replica moved since it asked (a reset, a wipe)
const layPage = function* layPage(
  asked: SyncState,
  answer: ChangesAnswer,
  touched: Touched,
): SqlPlan<boolean> {
  const now = yield* readSyncState();
  if (now.epoch !== asked.epoch || now.cursor !== asked.cursor) {
    return false;
  }
  for (const change of answer.changes) {
    yield* applyChange(change, touched);
  }
  yield* writeSyncState({ cursor: answer.upto, epoch: answer.epoch });
  return true;
};

export const pullChanges = async (context: PullContext): Promise<FetchOutcome> => {
  const { client, sql } = context;
  let resets = 0;
  for (;;) {
    const asked = await runPlanAsync(sql, readSyncState());
    const [error, answer] = await safe(
      client.library.sync.pull({ cursor: asked.cursor, epoch: asked.epoch }),
    );
    if (!context.live()) {
      return { kind: "closed" };
    }
    if (error !== null) {
      return failedWith(error);
    }
    if (answer.kind === "reset") {
      resets += 1;
      if (resets > MAX_RESETS) {
        return { failure: { kind: "unreachable", message: UNREACHABLE }, kind: "failed" };
      }
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, wipeSynced(answer.epoch));
      });
      await context.landed(touchedNothing(), true);
      continue;
    }
    const touched = touchedNothing();
    const laid = await sql.exclusive(
      async (tx) => await runPlanAsync(tx, layPage(asked, answer, touched)),
    );
    if (laid) {
      await context.landed(touched, false);
    }
    if (!answer.more || answer.upto <= asked.cursor) {
      return { kind: "done" };
    }
  }
};

export interface BodiesContext extends PullContext {
  // the item open on a screen, whose body goes first
  readonly focused: () => string | null;
}

const layBodies = function* layBodies(
  answer: Awaited<ReturnType<V1Client["library"]["sync"]["bodies"]>>,
  touched: Touched,
): SqlPlan<void> {
  const settled: string[] = [...answer.gone];
  for (const body of answer.bodies) {
    const landed = yield* storeItemBody({ blocks: body.blocks, id: body.id, seq: body.seq });
    if (landed) {
      touched.kinds.add("item");
      touched.ids.add(body.id);
      settled.push(body.id);
      continue;
    }
    // a body sent for another row leaves the want standing, or a row ahead of every block would
    // read as a body held empty until its own change was pulled
    const held = yield* readItem(body.id);
    if (held === null || held.kind === "purged") {
      settled.push(body.id);
    }
  }
  yield* dropWants(settled);
};

export const fetchBodies = async (context: BodiesContext): Promise<FetchOutcome> => {
  const { client, sql } = context;
  // each id is asked at most once a pass, so a body that cannot land yet is not asked for again
  const asked = new Set<string>();
  for (;;) {
    const focused = context.focused();
    const held = await runPlanAsync(sql, readWants());
    const wants = held
      .filter((want) => !asked.has(want.itemId))
      .toSorted(
        (a, b) =>
          Number(b.itemId === focused) - Number(a.itemId === focused) ||
          b.seq - a.seq ||
          (a.itemId < b.itemId ? -1 : 1),
      );
    if (wants.length === 0) {
      return { kind: "done" };
    }
    const ids = wants.slice(0, BODY_IDS_MAX).map((want) => want.itemId);
    const [error, answer] = await safe(client.library.sync.bodies({ ids }));
    if (!context.live()) {
      return { kind: "closed" };
    }
    if (error !== null) {
      return failedWith(error);
    }
    for (const id of [...answer.bodies.map((body) => body.id), ...answer.gone]) {
      asked.add(id);
    }
    const touched = touchedNothing();
    await sql.exclusive(async (tx) => {
      await runPlanAsync(tx, layBodies(answer, touched));
    });
    await context.landed(touched, false);
    // an answer that settles nothing is not one to ask again this pass
    if (answer.bodies.length === 0 && answer.gone.length === 0) {
      return { kind: "done" };
    }
  }
};
