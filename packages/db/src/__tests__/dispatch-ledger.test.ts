import { noopNotifier } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import { appendEventsInTransaction, threadHoldsDispatch, turnDispatchId } from "../events";
import {
  createPendingInteraction,
  interruptOpenPendingInteractions,
  listSettledRelayedInteractions,
  listUnrelayedOpenInteractions,
  setInteractionRelay,
} from "../pending-interactions";
import { createQueuedThreadMessageInTransaction } from "../queued-messages";
import { createThread, ensureThreadInTransaction, getThread } from "../threads";
import { openTempDb } from "./open-temp-db";

const DISPATCH = "a".repeat(32);

const append = (db: DbConnection, events: readonly ThreadEvent[]): void => {
  writeTransaction(db, (tx) => appendEventsInTransaction(tx, events));
};

const request = (threadId: string, dispatchId?: string): ThreadEvent =>
  dispatchId === undefined
    ? { scope: threadScope(), text: "typed", threadId, type: "client/turn/requested" }
    : { dispatchId, scope: threadScope(), text: "asked", threadId, type: "client/turn/requested" };

const started = (threadId: string, turnId: string): ThreadEvent => ({
  scope: turnScope(turnId),
  threadId,
  type: "turn/started",
});

describe("the dispatch ledger", () => {
  it("holds a dispatch its thread's request names, and no other", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    append(db, [request(thread.id), request(thread.id, DISPATCH)]);

    expect(threadHoldsDispatch(db, { dispatchId: DISPATCH, threadId: thread.id })).toBe(true);
    expect(threadHoldsDispatch(db, { dispatchId: "b".repeat(32), threadId: thread.id })).toBe(
      false,
    );
    const other = createThread(db, noopNotifier, {});
    expect(threadHoldsDispatch(db, { dispatchId: DISPATCH, threadId: other.id })).toBe(false);
  });

  it("holds a dispatch still waiting in the thread's queue", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    writeTransaction(db, (tx) =>
      createQueuedThreadMessageInTransaction(tx, {
        contextPaths: null,
        dispatchId: DISPATCH,
        text: "asked",
        threadId: thread.id,
      }),
    );

    expect(threadHoldsDispatch(db, { dispatchId: DISPATCH, threadId: thread.id })).toBe(true);
  });

  it("names the dispatch a turn carries out: the request it started from", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    append(db, [
      request(thread.id),
      started(thread.id, "turn_typed"),
      request(thread.id, DISPATCH),
      started(thread.id, "turn_asked"),
    ]);

    expect(turnDispatchId(db, { threadId: thread.id, turnId: "turn_typed" })).toBeNull();
    expect(turnDispatchId(db, { threadId: thread.id, turnId: "turn_asked" })).toBe(DISPATCH);
    expect(turnDispatchId(db, { threadId: thread.id, turnId: "turn_unknown" })).toBeNull();
  });
});

describe("a thread another device named", () => {
  it("takes the origin it was asked over only when this call creates it", () => {
    const db = openTempDb();
    const origin = { noteId: "note-plans", path: "Plans.md" };
    writeTransaction(db, (tx) => ensureThreadInTransaction(tx, "thr_phone", origin));
    expect(getThread(db, "thr_phone")).toMatchObject({
      originDocPath: "Plans.md",
      originNoteId: "note-plans",
    });

    const existing = createThread(db, noopNotifier, {});
    const ensured = writeTransaction(db, (tx) =>
      ensureThreadInTransaction(tx, existing.id, origin),
    );
    expect(ensured.created).toBe(false);
    expect(getThread(db, existing.id)).toMatchObject({ originDocPath: null, originNoteId: null });
  });
});

describe("an approval's relay", () => {
  it("is offered while open on a turn, and taken back once settled", () => {
    const db = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const onTurn = createPendingInteraction(db, noopNotifier, {
      payload: "{}",
      requestKey: "req_turn",
      threadId: thread.id,
      turnId: "turn_1",
    });
    createPendingInteraction(db, noopNotifier, {
      payload: "{}",
      requestKey: "req_turnless",
      threadId: thread.id,
    });
    expect(listUnrelayedOpenInteractions(db).map((row) => row.id)).toEqual([onTurn.id]);

    setInteractionRelay(db, onTurn.id, "opened");
    expect(listUnrelayedOpenInteractions(db)).toEqual([]);
    expect(listSettledRelayedInteractions(db)).toEqual([]);

    interruptOpenPendingInteractions(db, noopNotifier, thread.id);
    expect(listSettledRelayedInteractions(db).map((row) => row.id)).toEqual([onTurn.id]);

    setInteractionRelay(db, onTurn.id, "closed");
    expect(listSettledRelayedInteractions(db)).toEqual([]);
  });
});
