// A conversation's events as the cell keeps them: each one of the contract's own union
// (`@repo/contract/library/agent-events`), stored once as a row of the thread, which a read of
// the thread's events answers, and the thread named in the moved frame its commit sends. An event
// a thread's object pushed is named by that push's sequence and its place in it, the person's
// message that opened a turn by the turn.

import type { AgentEvent } from "@repo/contract/library/agent-events";
import { eq, max } from "drizzle-orm";

import { threadEvents } from "@repo/db/cell/schema";
import type { LandingScope } from "../library/cell-landing";

export const pushedEventId = (threadId: string, seq: number, index: number): string =>
  `${threadId}:${String(seq)}:${String(index)}`;

export const turnEventId = (threadId: string, turn: number): string =>
  `${threadId}:turn:${String(turn)}`;

// the event kept as the thread's next, once: one kept before is left as it is
export const storeEvent = (
  scope: LandingScope,
  threadId: string,
  eventId: string,
  event: AgentEvent,
): void => {
  const { db } = scope.storage;
  const kept = db
    .select({ eventId: threadEvents.eventId })
    .from(threadEvents)
    .where(eq(threadEvents.eventId, eventId))
    .get();
  if (kept !== undefined) {
    return;
  }
  const last = db
    .select({ idx: max(threadEvents.idx) })
    .from(threadEvents)
    .where(eq(threadEvents.threadId, threadId))
    .get();
  db.insert(threadEvents)
    .values({
      at: scope.now,
      eventId,
      idx: (last?.idx ?? -1) + 1,
      json: JSON.stringify(event),
      threadId,
      type: event.type,
    })
    .run();
  scope.moved.thread(threadId);
};
