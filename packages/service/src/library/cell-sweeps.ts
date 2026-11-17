// A sweep: a verb a person asks over every item a scope lists (`library.items.sweep`), which a
// device that read only some of the scope's pages cannot name by id. The ask takes the items the
// listing names at that moment and leaves them as jobs, a lot each (`./cell-jobs`), and the alarm
// lands a lot a transaction (`./cell-alarm`), each item by the rule its verb meets when it is
// asked by id (`./cell-items`).
//
// CLAUDE.md § A sweep is the cell's job, a lot a transaction. One transaction is not the answer: a
// landing costs half a millisecond over a short note and two over a saved article, measured in
// workerd, so 50,000 items take 27 to 100 s, past an invocation's 30, every other call of the
// account held behind them.

import type { sweepVerbSchema } from "@repo/contract/library/library-contract";
import { z } from "zod";

import type { CellActor } from "./cell-actor";
import type { CellDb } from "./cell-db";
import { askFill } from "./cell-fills";
import type { CellIds } from "./cell-ids";
import { organizeItems, purgeItems, setDeleted } from "./cell-items";
import { finishJob, scheduleJob } from "./cell-jobs";
import type { Lease } from "./cell-jobs";
import type { ItemScope } from "./cell-landing";
import type { LibraryEngine } from "./library-engine";

type SweepVerb = z.infer<typeof sweepVerbSchema>;

// only an app asks a sweep, on a person's press
const SWEEPER: CellActor = { kind: "person" };

// a lot's items: an alarm's run takes fifty lots (`./cell-jobs`), so it lands a thousand items and
// holds the cell a second or two
export const SWEEP_LOT = 20;

// the items a sweep takes, left as its lots, due at once: how many it took
export const askSweep = (
  db: CellDb,
  now: number,
  sweep: string,
  verb: SweepVerb,
  itemIds: readonly string[],
) => {
  for (let at = 0; at < itemIds.length; at += SWEEP_LOT) {
    const payload = { ids: itemIds.slice(at, at + SWEEP_LOT), verb };
    scheduleJob(db, { id: `sweep:${sweep}:${String(at)}`, kind: "sweep", payload }, now);
  }
  return { items: itemIds.length };
};

const sweepItem = (scope: ItemScope, ids: CellIds, verb: SweepVerb, itemId: string): void => {
  switch (verb.kind) {
    case "organize": {
      organizeItems(scope, ids, { ...verb, ids: [itemId] });
      break;
    }
    case "delete": {
      setDeleted(scope, { deleted: true, ids: [itemId] });
      break;
    }
    case "restore": {
      for (const item of setDeleted(scope, { deleted: false, ids: [itemId] }).landed) {
        askFill(scope, item);
      }
      break;
    }
    case "purge": {
      purgeItems(scope, [itemId]);
      break;
    }
    // no default
  }
};

// One lot landed, and its job ended with it. Each item lands apart, so one a rule refuses, or gone
// since the ask, is left as it is while the rest land: a refusal thrown past its own item would
// roll the lot back under a job that then never ends
export const landSweep = (library: LibraryEngine, job: Lease<"sweep">): void => {
  library.land(SWEEPER, { answer: z.object({}), opId: undefined }, (scope) => {
    for (const itemId of job.payload.ids) {
      scope.attempt(() => {
        sweepItem(scope, library.ids, job.payload.verb, itemId);
      });
    }
    finishJob(scope.db, job);
    return {};
  });
};
