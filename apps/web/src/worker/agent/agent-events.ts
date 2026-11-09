// A conversation's events as the cell keeps them: each one of the contract's own union
// (`@repo/contract/library/agent-events`), stored once as a row of the thread, which a read of
// the thread's events answers, and told to the account's sockets once it commits. An event a
// thread's object pushed is named by that push's sequence and its place in it, the person's
// message that opened a turn by the turn.

import type { AgentEvent } from "@repo/contract/library/agent-events";
import type { threadEventRowSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import type { LandingScope } from "../library/cell-landing";
import { threadEventRowOf } from "../library/cell-threads";

export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

export const pushedEventId = (threadId: string, seq: number, index: number): string =>
  `${threadId}:${String(seq)}:${String(index)}`;

export const turnEventId = (threadId: string, turn: number): string =>
  `${threadId}:turn:${String(turn)}`;

const idxSchema = z.object({ idx: z.number() });

// the event kept as the thread's next, once: its row, or null for one kept before
export const storeEvent = (
  scope: LandingScope,
  threadId: string,
  eventId: string,
  event: AgentEvent,
): ThreadEventRow | null => {
  const { storage } = scope;
  if (storage.all("SELECT 1 FROM thread_events WHERE event_id = ?", [eventId]).length > 0) {
    return null;
  }
  const [last] = storage.all(
    "SELECT coalesce(max(idx), -1) AS idx FROM thread_events WHERE thread_id = ?",
    [threadId],
  );
  const seq = scope.seq();
  storage.run(
    `INSERT INTO thread_events (event_id, thread_id, idx, type, json, at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      threadId,
      idxSchema.parse(last).idx + 1,
      event.type,
      JSON.stringify(event),
      scope.now,
      seq,
    ],
  );
  scope.moved.thread(threadId);
  return threadEventRowOf(storage, eventId);
};
