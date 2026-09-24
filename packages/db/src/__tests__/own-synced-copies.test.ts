import { noopNotifier } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import {
  appendEventsInTransaction,
  appendSyncedEventsInTransaction,
  listStoredThreadEvents,
} from "../events";
import { removeOwnSyncedCopiesInTransaction } from "../own-synced-copies";
import type { OwnSyncedCopiesRemoval } from "../own-synced-copies";
import { ownDeviceIds, recordOwnDevice } from "../sync-outbox";
import { createThread } from "../threads";
import { openTempDb } from "./open-temp-db";

const request = (threadId: string, text: string): ThreadEvent => ({
  scope: threadScope(),
  text,
  threadId,
  type: "client/turn/requested",
});

const turn = (threadId: string, turnId: string, reply: string): ThreadEvent[] => [
  { scope: turnScope(turnId), threadId, type: "turn/started" },
  {
    delta: reply,
    itemId: `${turnId}_reply`,
    scope: turnScope(turnId),
    threadId,
    type: "item/agentMessage/delta",
  },
  { scope: turnScope(turnId), status: "completed", threadId, type: "turn/completed" },
];

const appendLocal = (db: DbConnection, events: readonly ThreadEvent[]): void => {
  writeTransaction(db, (tx) => appendEventsInTransaction(tx, events));
};

// how a pull lands rows: each under the device that pushed it, at that device's position.
const appendPulled = (
  db: DbConnection,
  deviceId: string,
  events: readonly ThreadEvent[],
  firstSeq = 0,
): void => {
  writeTransaction(db, (tx) =>
    appendSyncedEventsInTransaction(
      tx,
      events.map((event, index) => ({ event, origin: { deviceId, deviceSeq: firstSeq + index } })),
    ),
  );
};

const removeCopies = (db: DbConnection): OwnSyncedCopiesRemoval =>
  writeTransaction(db, (tx) => removeOwnSyncedCopiesInTransaction(tx));

const storedEvents = (db: DbConnection, threadId: string): ThreadEvent[] =>
  listStoredThreadEvents(db, { threadId }).map((row) => row.event);

describe("removing this install's own rows pulled back from the log", () => {
  it("keeps the originals and another device's rows, and learns the id the copies came under", () => {
    const db = openTempDb();
    const { id: threadId } = createThread(db, noopNotifier, {});
    // the same words twice: a copy of each goes, and nothing keyed on the words alone would tell.
    const written = [
      request(threadId, "yes"),
      ...turn(threadId, "turn_mine_1", "one"),
      request(threadId, "yes"),
      ...turn(threadId, "turn_mine_2", "two"),
    ];
    appendLocal(db, written);
    // another device's turn, and a request in words this install also wrote.
    const theirs = [request(threadId, "yes"), ...turn(threadId, "turn_theirs", "three")];
    appendPulled(db, "dev_other", theirs);
    // signing in again before the planner skipped earlier ids: everything pushed under the
    // earlier one came back.
    appendPulled(db, "dev_before", written);
    // a row under the earlier id this install holds no original of stays: it is the only record.
    const alone = request(threadId, "only in the log");
    appendPulled(db, "dev_before", [alone], written.length);
    recordOwnDevice(db, "dev_now");

    const removal = removeCopies(db);

    expect(removal).toEqual({ removed: written.length, threadIds: [threadId] });
    expect(storedEvents(db, threadId)).toEqual([...written, ...theirs, alone]);
    expect(ownDeviceIds(db)).toEqual(new Set(["dev_before", "dev_now"]));
  });

  it("removes a copy under any id the install has recorded, without a shared turn", () => {
    const db = openTempDb();
    const { id: threadId } = createThread(db, noopNotifier, {});
    appendLocal(db, [request(threadId, "hello")]);
    appendPulled(db, "dev_recorded", [request(threadId, "hello")]);
    recordOwnDevice(db, "dev_recorded");

    expect(removeCopies(db).removed).toBe(1);
    expect(storedEvents(db, threadId)).toEqual([request(threadId, "hello")]);
  });

  it("runs once per database", () => {
    const db = openTempDb();
    const { id: threadId } = createThread(db, noopNotifier, {});
    const written = turn(threadId, "turn_mine", "one");
    appendLocal(db, written);
    expect(removeCopies(db)).toEqual({ removed: 0, threadIds: [] });

    appendPulled(db, "dev_before", written);
    expect(removeCopies(db)).toEqual({ removed: 0, threadIds: [] });
    expect(storedEvents(db, threadId)).toEqual([...written, ...written]);
  });
});
