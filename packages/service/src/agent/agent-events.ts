// A conversation's events as the cell keeps them: each one of the contract's own union
// (`@repo/contract/library/agent-events`), stored once as a row of the thread, which a read of
// the thread's events answers, and the thread named in the moved frame its commit sends. An event
// a thread's object pushed is named by that push's sequence and its place in it, the person's
// message that opened a turn by the turn.

import type { AgentEvent } from "@repo/contract/library/agent-events";
import { z } from "zod";

import type { LandingScope } from "../library/cell-landing";

export const pushedEventId = (threadId: string, seq: number, index: number): string =>
  `${threadId}:${String(seq)}:${String(index)}`;

export const turnEventId = (threadId: string, turn: number): string =>
  `${threadId}:turn:${String(turn)}`;

const idxSchema = z.object({ idx: z.number() });

// the event kept as the thread's next, once: one kept before is left as it is
export const storeEvent = (
  scope: LandingScope,
  threadId: string,
  eventId: string,
  event: AgentEvent,
): void => {
  const { storage } = scope;
  if (storage.all("SELECT 1 FROM thread_events WHERE event_id = ?", [eventId]).length > 0) {
    return;
  }
  const [last] = storage.all(
    "SELECT coalesce(max(idx), -1) AS idx FROM thread_events WHERE thread_id = ?",
    [threadId],
  );
  storage.run(
    `INSERT INTO thread_events (event_id, thread_id, idx, type, json, at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      threadId,
      idxSchema.parse(last).idx + 1,
      event.type,
      JSON.stringify(event),
      scope.now,
    ],
  );
  scope.moved.thread(threadId);
};
