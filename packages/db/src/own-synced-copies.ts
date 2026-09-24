import { and, eq, exists, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { DbTransaction } from "./connection";
import { getMetaValue } from "./meta";
import { events, meta } from "./schema";
import { ownDeviceIds, recordOwnDevice } from "./sync-outbox";

// present once the removal has run; the value is how many rows it removed.
const REMOVAL_META_KEY = "own_synced_copies_removed";

const original = alias(events, "original");

export interface OwnSyncedCopiesRemoval {
  removed: number;
  // every thread that lost a row, so the caller can re-project what the copies moved.
  threadIds: readonly string[];
}

// a device id this install signed in under but never recorded: it pushed a turn this install ran,
// and a turn id is minted by the one install that runs the turn.
const earlierOwnDeviceIds = (tx: DbTransaction): string[] =>
  tx
    .selectDistinct({ deviceId: events.originDeviceId })
    .from(events)
    .innerJoin(
      original,
      and(
        eq(original.threadId, events.threadId),
        eq(original.turnId, events.turnId),
        eq(original.type, "turn/started"),
        isNull(original.originDeviceId),
      ),
    )
    .where(and(eq(events.type, "turn/started"), isNotNull(events.originDeviceId)))
    .all()
    .flatMap((row) => (row.deviceId === null ? [] : [row.deviceId]));

// a database can hold copies of rows it pushed under an earlier device id, beside the null-origin
// rows it wrote them as. this removes them once per database, since the planner skips every
// recorded id; the earlier ids are recorded too, or a replay of the log would land the removed
// rows again.
export const removeOwnSyncedCopiesInTransaction = (tx: DbTransaction): OwnSyncedCopiesRemoval => {
  if (getMetaValue(tx, REMOVAL_META_KEY) !== undefined) {
    return { removed: 0, threadIds: [] };
  }
  for (const deviceId of earlierOwnDeviceIds(tx)) {
    recordOwnDevice(tx, deviceId);
  }
  const own = [...ownDeviceIds(tx)];
  // only a row whose original is beside it: one this install no longer holds is the only record
  // of what it says. equal data implies the rest of the match; the turn, type and item are spelled
  // out so the lookup seeks the (thread, turn, type, item) index instead of walking the thread.
  const removed =
    own.length === 0
      ? []
      : tx
          .delete(events)
          .where(
            and(
              inArray(events.originDeviceId, own),
              exists(
                tx
                  .select({ id: original.id })
                  .from(original)
                  .where(
                    and(
                      eq(original.threadId, events.threadId),
                      sql`${original.turnId} IS ${events.turnId}`,
                      eq(original.type, events.type),
                      sql`${original.itemId} IS ${events.itemId}`,
                      isNull(original.originDeviceId),
                      eq(original.data, events.data),
                    ),
                  ),
              ),
            ),
          )
          .returning({ threadId: events.threadId })
          .all();
  tx.insert(meta)
    .values({ key: REMOVAL_META_KEY, value: String(removed.length) })
    .run();
  return {
    removed: removed.length,
    threadIds: [...new Set(removed.map((row) => row.threadId))],
  };
};
