// A change set is what History shows and Undo takes back: every write joins its actor's open set,
// and the set seals by its actor's policy (`./cell-actor`), when a job on the alarm finds it quiet
// or past its cap, never by a timer, so an eviction loses no deadline. Each item a set touches
// keeps its state before the set's first write; its after is the item as it is while the set is
// the last to have changed it, written down when the set seals or another set is about to change
// the item. Writing an after down writes the item's revision with it, stamped with that moment, so
// an item's revisions run in the order its states held and the newest is the item as it stands,
// however its sets' seals interleave.

import { deriveItem } from "@repo/notes/library/derive-item";
import { readItemState, storeSearchRow } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import type { ItemNow } from "@repo/notes/library/revert-change";
import { z } from "zod";

import { SEAL_POLICIES } from "./cell-actor";
import type { CellActor, ChangeSetActor, SealPolicy } from "./cell-actor";
import { annotationStoreOf, readAnnotationRows } from "./cell-annotations";
import { dropJob, ensureJob, scheduleJob } from "./cell-jobs";
import { encodeParts, storeParts } from "./cell-parts";
import type { PartRefs } from "./cell-parts";
import { PRUNE_EVERY_MS } from "./history-prune";

// the history prune's job, made with the first sealed revision and run once a day
export const PRUNE_JOB = {
  id: "prune",
  kind: "prune",
  payload: JSON.stringify({ after: null }),
} as const;

export interface OpenSet {
  readonly id: string;
  readonly actor: ChangeSetActor;
  readonly policy: SealPolicy;
}

// the columns that tell one actor's open set from another's
interface ActorKeys {
  readonly actorId: string | null;
  readonly clientId: string | null;
  readonly deviceId: string | null;
  readonly threadId: string | null;
  readonly turn: number | null;
}

const NO_KEYS: ActorKeys = {
  actorId: null,
  clientId: null,
  deviceId: null,
  threadId: null,
  turn: null,
};

const keysOf = (actor: CellActor): ActorKeys => {
  switch (actor.kind) {
    case "person": {
      return { ...NO_KEYS, deviceId: actor.deviceId };
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
    case "fill":
    case "system": {
      return NO_KEYS;
    }
    // no default
  }
};

const openRowSchema = z.object({
  id: z.string(),
  opened_at: z.number(),
  touched_at: z.number(),
});

const sealJobOf = (id: string) =>
  ({ id: `seal:${id}`, kind: "seal", payload: JSON.stringify({ changeSetId: id }) }) as const;

// a quiet set closes after its quiet, or at its cap counted from its first write
const quietDeadline = (
  policy: Extract<SealPolicy, { kind: "quiet" }>,
  openedAt: number,
  touchedAt: number,
): number =>
  policy.capMs === null
    ? touchedAt + policy.quietMs
    : Math.min(touchedAt + policy.quietMs, openedAt + policy.capMs);

const findOpen = (sql: SqlStatements, actor: ChangeSetActor, keys: ActorKeys) => {
  const [row] = sql.all(
    `SELECT id, opened_at, touched_at FROM change_sets
     WHERE actor = ? AND sealed_at IS NULL AND actor_id IS ? AND client_id IS ? AND device_id IS ?
       AND thread_id IS ? AND turn IS ?
     ORDER BY opened_at DESC LIMIT 1`,
    [actor, keys.actorId, keys.clientId, keys.deviceId, keys.threadId, keys.turn],
  );
  return row === undefined ? null : openRowSchema.parse(row);
};

const insertSet = (
  sql: SqlStatements,
  set: { readonly id: string; readonly actor: ChangeSetActor; readonly label: string },
  keys: ActorKeys,
  now: number,
): void => {
  sql.run(
    `INSERT INTO change_sets (id, actor, actor_id, label, device_id, thread_id, turn, client_id,
       opened_at, touched_at, sealed_at, undone_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      set.id,
      set.actor,
      keys.actorId,
      set.label,
      keys.deviceId,
      keys.threadId,
      keys.turn,
      keys.clientId,
      now,
      now,
    ],
  );
};

export const readItemNow = (sql: SqlStatements, itemId: string): ItemNow | null => {
  const state = runPlan(sql, readItemState(itemId));
  return state === null
    ? null
    : { annotations: annotationStoreOf(readAnnotationRows(sql, itemId)), state };
};

// the set's after for the item, and the item's next revision holding it: the item as it stood
// until `at`
const writeAfter = (
  sql: SqlStatements,
  change: { readonly setId: string; readonly itemId: string; readonly refs: PartRefs },
  at: number,
): void => {
  const { itemId, refs, setId } = change;
  sql.run(
    `UPDATE change_set_items SET after_fields = ?, after_manifest = ?, after_annotations = ?
     WHERE change_set_id = ? AND item_id = ?`,
    [refs.fields, refs.manifest, refs.annotations, setId, itemId],
  );
  sql.run(
    `INSERT INTO revisions (item_id, rev, change_set_id, at, fields, manifest)
     SELECT ?, coalesce(max(rev), 0) + 1, ?, ?, ?, ? FROM revisions WHERE item_id = ?`,
    [itemId, setId, at, refs.fields, refs.manifest, itemId],
  );
};

const sealRowSchema = z.object({ actor: z.string(), sealed_at: z.number().nullable() });
const setItemSchema = z.object({ after_fields: z.string().nullable(), item_id: z.string() });

// writes the after and revision of each item the set still holds open, and closes the set; false
// when it was already sealed or never was. An item another set changed since already has both,
// written at that change
export const sealChangeSet = (sql: SqlStatements, setId: string, now: number): boolean => {
  const [raw] = sql.all("SELECT actor, sealed_at FROM change_sets WHERE id = ?", [setId]);
  const set = raw === undefined ? null : sealRowSchema.parse(raw);
  if (set === null || set.sealed_at !== null) {
    dropJob(sql, sealJobOf(setId).id);
    return false;
  }
  const items = sql
    .all("SELECT item_id, after_fields FROM change_set_items WHERE change_set_id = ?", [setId])
    .map((row) => setItemSchema.parse(row));
  for (const item of items) {
    const current = readItemNow(sql, item.item_id);
    if (item.after_fields === null) {
      if (current === null) {
        sql.run("DELETE FROM change_set_items WHERE change_set_id = ? AND item_id = ?", [
          setId,
          item.item_id,
        ]);
        continue;
      }
      const refs = storeParts(sql, item.item_id, encodeParts(current));
      writeAfter(sql, { itemId: item.item_id, refs, setId }, now);
    }
    // a person's typing reindexes once its set closes, not on every keystroke's write
    if (set.actor === "person" && current !== null) {
      const { blocks, fields: itemFields } = current.state;
      runPlan(sql, storeSearchRow(item.item_id, deriveItem(itemFields, blocks).search));
    }
  }
  sql.run("UPDATE change_sets SET sealed_at = ? WHERE id = ?", [now, setId]);
  dropJob(sql, sealJobOf(setId).id);
  ensureJob(sql, PRUNE_JOB, now + PRUNE_EVERY_MS);
  return true;
};

// the actor's open set, which this write joins: a new one when it has none, when its own has gone
// quiet past its deadline (sealed here, since the alarm may run late), or when one write is a set
export const joinChangeSet = (
  sql: SqlStatements,
  actor: CellActor,
  now: number,
  newId: () => string,
): OpenSet => {
  const policy = SEAL_POLICIES[actor.kind];
  const keys = keysOf(actor);
  if (policy.kind !== "commit") {
    const open = findOpen(sql, actor.kind, keys);
    if (open !== null) {
      const overdue =
        policy.kind === "quiet" && quietDeadline(policy, open.opened_at, open.touched_at) <= now;
      if (!overdue) {
        sql.run("UPDATE change_sets SET touched_at = ? WHERE id = ?", [now, open.id]);
        if (policy.kind === "quiet") {
          scheduleJob(sql, sealJobOf(open.id), quietDeadline(policy, open.opened_at, now));
        }
        return { actor: actor.kind, id: open.id, policy };
      }
      sealChangeSet(sql, open.id, now);
    }
  }
  const id = newId();
  insertSet(sql, { actor: actor.kind, id, label: actor.label }, keys, now);
  if (policy.kind === "quiet") {
    scheduleJob(sql, sealJobOf(id), quietDeadline(policy, now, now));
  }
  return { actor: actor.kind, id, policy };
};

// an undo is a set of its own, by whoever asked for it, sealed with the write
export const openUndoSet = (
  sql: SqlStatements,
  requester: CellActor,
  now: number,
  newId: () => string,
): OpenSet => {
  const id = newId();
  insertSet(sql, { actor: "undo", id, label: requester.label }, keysOf(requester), now);
  return { actor: "undo", id, policy: SEAL_POLICIES.undo };
};

const itemRowSchema = z.object({ after_fields: z.string().nullable() });
const otherSetSchema = z.object({ change_set_id: z.string() });

// the set's first write to the item keeps the item as it was; and the other open set whose after
// is the item as it is now writes that after down, with its revision, since this write at `now` is
// about to change it
export const touchItem = (
  sql: SqlStatements,
  change: { readonly setId: string; readonly itemId: string; readonly before: ItemNow | null },
  now: number,
): void => {
  const { before, itemId, setId } = change;
  const [held] = sql.all(
    "SELECT after_fields FROM change_set_items WHERE change_set_id = ? AND item_id = ?",
    [setId, itemId],
  );
  const others = sql
    .all(
      `SELECT change_set_id FROM change_set_items
       WHERE item_id = ? AND change_set_id != ? AND after_fields IS NULL`,
      [itemId, setId],
    )
    .map((row) => otherSetSchema.parse(row).change_set_id);
  const refs =
    before !== null && (held === undefined || others.length > 0)
      ? storeParts(sql, itemId, encodeParts(before))
      : null;
  if (refs !== null) {
    for (const other of others) {
      writeAfter(sql, { itemId, refs, setId: other }, now);
    }
  }
  if (held === undefined) {
    sql.run(
      `INSERT INTO change_set_items (change_set_id, item_id, created, before_fields,
         before_manifest, before_annotations, after_fields, after_manifest, after_annotations)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [
        setId,
        itemId,
        before === null ? 1 : 0,
        refs?.fields ?? null,
        refs?.manifest ?? null,
        refs?.annotations ?? null,
      ],
    );
  } else if (itemRowSchema.parse(held).after_fields !== null) {
    // written down when another set wrote; the item is this set's again
    sql.run(
      `UPDATE change_set_items SET after_fields = NULL, after_manifest = NULL,
         after_annotations = NULL WHERE change_set_id = ? AND item_id = ?`,
      [setId, itemId],
    );
  }
};
