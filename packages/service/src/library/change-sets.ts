// A change set is what Undo takes back: every write joins its actor's open set, and the set seals
// by its actor's policy (`./cell-actor`), when a job on the alarm finds it quiet or past its cap,
// never by a timer, so an eviction loses no deadline. Each item a set touches keeps its state
// before the set's first write; its after is the item as it is while the set is the last to have
// changed it, written down when the set seals or another set is about to change the item, so a
// set's after is the item as that set left it however its sets' seals interleave. A set keeps an
// item's fields; what an agent's set did to a note's body is that note's turn log, under the set's id.

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readLiveItem } from "./library-queries";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { changeSetItems, changeSets } from "@repo/db/cell/schema";
import { SEAL_POLICIES } from "./cell-actor";
import type { CellActor, ChangeSetActor, SealPolicy } from "./cell-actor";
import { dropJob, ensureJob, scheduleJob } from "./cell-jobs";
import type { JobRequest } from "./cell-jobs";
import type { CellDb } from "./cell-db";
import { storeFieldsPart } from "./cell-parts";
import type { CellStorage } from "./cell-storage";
import { PRUNE_EVERY_MS } from "./change-set-prune";

// the change-set prune's job, made by whichever lands first, a sealed set or an op's answer,
// either of which it bounds, and run once a day
export const PRUNE_JOB: JobRequest<"prune"> = { id: "prune", kind: "prune", payload: {} };

export interface OpenSet {
  readonly id: string;
  readonly actor: ChangeSetActor;
  readonly policy: SealPolicy;
}

// the columns that tell one actor's open set from another's
interface ActorKeys {
  readonly actorId: string | null;
  readonly clientId: string | null;
  readonly sessionId: string | null;
  readonly threadId: string | null;
  readonly turn: number | null;
}

const NO_KEYS: ActorKeys = {
  actorId: null,
  clientId: null,
  sessionId: null,
  threadId: null,
  turn: null,
};

const keysOf = (actor: CellActor): ActorKeys => {
  switch (actor.kind) {
    case "person": {
      return { ...NO_KEYS, sessionId: actor.sessionId };
    }
    case "assistant": {
      return { ...NO_KEYS, actorId: actor.grantId, clientId: actor.clientId };
    }
    case "agent": {
      return { ...NO_KEYS, threadId: actor.threadId, turn: actor.turn };
    }
    case "import": {
      return { ...NO_KEYS, actorId: actor.jobId };
    }
    case "fill": {
      return NO_KEYS;
    }
    // no default
  }
};

const sealJobOf = (id: string): JobRequest<"seal"> => ({
  id: `seal:${id}`,
  kind: "seal",
  payload: { changeSetId: id },
});

// a quiet set closes after its quiet, or at its cap counted from its first write
const quietDeadline = (
  policy: Extract<SealPolicy, { kind: "quiet" }>,
  openedAt: number,
  touchedAt: number,
): number =>
  policy.capMs === null
    ? touchedAt + policy.quietMs
    : Math.min(touchedAt + policy.quietMs, openedAt + policy.capMs);

// SQL's `IS`: a key the actor lacks matches only a set that lacks it too
const keyIs = (column: AnySQLiteColumn, value: string | number | null): SQL =>
  value === null ? isNull(column) : eq(column, value);

const findOpen = (db: CellDb, actor: ChangeSetActor, keys: ActorKeys) =>
  db
    .select({ id: changeSets.id, openedAt: changeSets.openedAt, touchedAt: changeSets.touchedAt })
    .from(changeSets)
    .where(
      and(
        eq(changeSets.actor, actor),
        isNull(changeSets.sealedAt),
        keyIs(changeSets.actorId, keys.actorId),
        keyIs(changeSets.clientId, keys.clientId),
        keyIs(changeSets.sessionId, keys.sessionId),
        keyIs(changeSets.threadId, keys.threadId),
        keyIs(changeSets.turn, keys.turn),
      ),
    )
    .orderBy(desc(changeSets.openedAt))
    .limit(1)
    .get() ?? null;

const insertSet = (
  db: CellDb,
  set: { readonly id: string; readonly actor: ChangeSetActor; readonly label: string },
  keys: ActorKeys,
  now: number,
): void => {
  db.insert(changeSets)
    .values({ ...set, ...keys, openedAt: now, touchedAt: now })
    .run();
};

// the item's fields as they are; null once it was purged
const readFieldsNow = (db: CellDb, itemId: string): LibraryItemFields | null =>
  readLiveItem(db, itemId)?.fields ?? null;

const entryIs = (setId: string, itemId: string): SQL | undefined =>
  and(eq(changeSetItems.changeSetId, setId), eq(changeSetItems.itemId, itemId));

// the set's after for the item: its fields as the set left them
const writeAfter = (
  db: CellDb,
  change: { readonly setId: string; readonly itemId: string; readonly fields: string | null },
): void => {
  db.update(changeSetItems)
    .set({ afterFields: change.fields })
    .where(entryIs(change.setId, change.itemId))
    .run();
};

// whether a change set is sealed, or null for one the library does not keep
export const setSealed = (storage: CellStorage, setId: string): boolean | null => {
  const set = storage.db
    .select({ sealedAt: changeSets.sealedAt })
    .from(changeSets)
    .where(eq(changeSets.id, setId))
    .get();
  return set === undefined ? null : set.sealedAt !== null;
};

// writes the after of each item the set still holds open, and closes the set, unless it was
// already sealed or never was. An item another set changed since already has its after, written at
// that change
export const sealChangeSet = (storage: CellStorage, setId: string, now: number): void => {
  const { db } = storage;
  if (setSealed(storage, setId) !== false) {
    dropJob(db, sealJobOf(setId).id);
    return;
  }
  const entries = db
    .select({ afterFields: changeSetItems.afterFields, itemId: changeSetItems.itemId })
    .from(changeSetItems)
    .where(eq(changeSetItems.changeSetId, setId))
    .all();
  for (const { afterFields, itemId } of entries) {
    if (afterFields !== null) {
      continue;
    }
    const current = readFieldsNow(db, itemId);
    if (current === null) {
      db.delete(changeSetItems).where(entryIs(setId, itemId)).run();
      continue;
    }
    writeAfter(db, { fields: storeFieldsPart(db, itemId, current), itemId, setId });
  }
  db.update(changeSets).set({ sealedAt: now }).where(eq(changeSets.id, setId)).run();
  dropJob(db, sealJobOf(setId).id);
  ensureJob(db, PRUNE_JOB, now + PRUNE_EVERY_MS);
};

// the actor's open set, which this write joins: a new one when it has none, when its own has gone
// quiet past its deadline (sealed here, since the alarm may run late), or when one write is a set
export const joinChangeSet = (
  storage: CellStorage,
  actor: CellActor,
  now: number,
  newId: () => string,
): OpenSet => {
  const policy = SEAL_POLICIES[actor.kind];
  const keys = keysOf(actor);
  if (policy.kind !== "commit") {
    const open = findOpen(storage.db, actor.kind, keys);
    if (open !== null) {
      const overdue =
        policy.kind === "quiet" && quietDeadline(policy, open.openedAt, open.touchedAt) <= now;
      if (!overdue) {
        storage.db
          .update(changeSets)
          .set({ touchedAt: now })
          .where(eq(changeSets.id, open.id))
          .run();
        if (policy.kind === "quiet") {
          scheduleJob(storage.db, sealJobOf(open.id), quietDeadline(policy, open.openedAt, now));
        }
        return { actor: actor.kind, id: open.id, policy };
      }
      sealChangeSet(storage, open.id, now);
    }
  }
  const id = newId();
  insertSet(storage.db, { actor: actor.kind, id, label: actor.label }, keys, now);
  if (policy.kind === "quiet") {
    scheduleJob(storage.db, sealJobOf(id), quietDeadline(policy, now, now));
  }
  return { actor: actor.kind, id, policy };
};

// an undo is a set of its own, by whoever asked for it, sealed with the write
export const openUndoSet = (
  storage: CellStorage,
  requester: CellActor,
  now: number,
  newId: () => string,
): OpenSet => {
  const id = newId();
  insertSet(storage.db, { actor: "undo", id, label: requester.label }, keysOf(requester), now);
  return { actor: "undo", id, policy: SEAL_POLICIES.undo };
};

// the set's first write to the item keeps the item as it was; and the other open set whose after
// is the item as it is now writes that after down, since this write is about to change it
export const touchItem = (
  storage: CellStorage,
  change: {
    readonly setId: string;
    readonly itemId: string;
    readonly before: LibraryItemFields | null;
  },
): void => {
  const { db } = storage;
  const { before, itemId, setId } = change;
  const held = db
    .select({ afterFields: changeSetItems.afterFields })
    .from(changeSetItems)
    .where(entryIs(setId, itemId))
    .get();
  const others = db
    .select({ changeSetId: changeSetItems.changeSetId })
    .from(changeSetItems)
    .where(
      and(
        eq(changeSetItems.itemId, itemId),
        ne(changeSetItems.changeSetId, setId),
        isNull(changeSetItems.afterFields),
      ),
    )
    .all()
    .map((row) => row.changeSetId);
  const fields =
    before !== null && (held === undefined || others.length > 0)
      ? storeFieldsPart(db, itemId, before)
      : null;
  if (fields !== null) {
    for (const other of others) {
      writeAfter(db, { fields, itemId, setId: other });
    }
  }
  if (held === undefined) {
    db.insert(changeSetItems)
      .values({
        beforeFields: fields,
        changeSetId: setId,
        created: before === null ? 1 : 0,
        itemId,
      })
      .run();
  } else if (held.afterFields !== null) {
    // written down when another set wrote; the item is this set's again
    writeAfter(db, { fields: null, itemId, setId });
  }
};
