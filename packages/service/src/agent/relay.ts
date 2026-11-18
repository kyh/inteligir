// A thread's events as its record hook kept them, then the eve session it runs on followed live from
// where those end; an event in both goes once, by its position. Positions only grow, so a device
// that reconnects with the last id it read (`lastEventId`) gets only what came after, and a draft,
// never kept, only from where its stream picks up. Its route cuts the stream before its
// `maxDuration`, and the device reconnects where it left off.

import { NotFoundError } from "@repo/contract/rpc/v1-errors";
import type { threadStreamEventSchema } from "@repo/contract/library/library-wire";
import { db } from "@repo/db/drizzle-client";
import { withEventMeta } from "@orpc/server";
import { setTimeout as sleep } from "node:timers/promises";
import type { z } from "zod";

import type { ThreadEventRow, ThreadRow, TurnAt } from "./agent-threads";
import { keptEventAt, threadHistory, threadOf, turnOf } from "./agent-threads";
import type { AgentPlatform, AgentStreamEvent } from "./platform";
import { isSessionEnded } from "./platform";
import type { AgentRuntime } from "./runtime";
import type { ThreadPosition } from "./thread-events";
import { comparePositions, cursorOf, draftReader, parseCursor, shownEvent } from "./thread-events";

type ThreadStreamEvent = z.infer<typeof threadStreamEventSchema>;

// how often a thread with no eve session left to follow is read for its next
const NEXT_SESSION_POLL_MS = 2000;

// how soon a device reconnects to a stream that dropped
const RECONNECT_MS = 1000;

// the kept events read at once while catching up
const HISTORY_PAGE = 500;

// how often a live turn's end asks whether its settle is kept yet: this often at first, then at the
// beat a thread with no session to follow is read at
const SETTLE_POLL_MS = 100;
const SETTLE_QUICK_MS = 10_000;

interface FollowedSession {
  readonly accountId: string;
  readonly threadId: string;
  readonly eveSessionId: string;
  readonly eveSessionNumber: number;
}

// eve streams a turn's settle as its record hook keeps it, which seals what Undo takes back and
// idles the thread at once, so its end waits for that however long it takes, nothing after it
// streaming first, and shows as the hook kept it: a device that asks again as it lands reads both.
// A turn the cron settled first has its end kept where the cron put it, which shows on the next
// read of what the thread kept; null for that, and once `stop` aborts
const keptEnd = async (
  at: TurnAt,
  position: ThreadPosition,
  { pollMs, stop }: { readonly pollMs: number; readonly stop: AbortSignal },
): Promise<ThreadEventRow | null> => {
  const quickUntil = Date.now() + SETTLE_QUICK_MS;
  while (!stop.aborted) {
    const turn = await turnOf(db, at);
    if (turn !== null && turn.settledAt !== null) {
      return await keptEventAt(at.accountId, at.threadId, position);
    }
    // an abort ends the wait early with an AbortError: the loop then stops
    await sleep(Date.now() < quickUntil ? SETTLE_POLL_MS : pollMs, undefined, {
      signal: stop,
    }).catch(() => null);
  }
  return null;
};

// what the thread shows of a fact as it happens: the record hook's event, a turn's end as it was
// kept
const relayedRow = async (
  session: FollowedSession,
  recorded: AgentStreamEvent,
  at: ThreadPosition,
  wait: { readonly pollMs: number; readonly stop: AbortSignal },
): Promise<ThreadEventRow | null> => {
  const { accountId, eveSessionNumber, threadId } = session;
  if (recorded.type === "turn.settled") {
    return await keptEnd(
      { accountId, eveSessionNumber, eveTurnId: recorded.data.turnId, threadId },
      at,
      wait,
    );
  }
  const event = shownEvent(recorded, eveSessionNumber);
  return event === null
    ? null
    : {
        at: Date.parse(recorded.meta.at),
        event,
        eventId: cursorOf(at),
        threadId,
        type: event.type,
      };
};

interface SessionEvent {
  // none for a draft: it is never kept
  readonly at: ThreadPosition | null;
  readonly event: ThreadStreamEvent;
}

// what the thread shows of one eve session from its line `startIndex`, until it ends or `stop`
// aborts
const sessionEvents = async function* sessionEvents(
  platform: AgentPlatform,
  session: FollowedSession,
  from: { readonly startIndex: number; readonly pollMs: number },
  stop: AbortSignal,
): AsyncGenerator<SessionEvent> {
  const draftOf = draftReader();
  const caller = {
    accountId: session.accountId,
    eveSessionNumber: session.eveSessionNumber,
    threadId: session.threadId,
  };
  try {
    for await (const recorded of platform.stream(caller, session.eveSessionId, {
      signal: stop,
      startIndex: from.startIndex,
    })) {
      const at = { ...recorded.meta.position, session: session.eveSessionNumber };
      const row = await relayedRow(session, recorded, at, { pollMs: from.pollMs, stop });
      const draft = row === null ? draftOf(recorded) : null;
      if (row !== null) {
        yield { at, event: { kind: "event", row } };
      } else if (draft !== null) {
        yield { at: null, event: { kind: "draft", text: draft } };
      }
    }
  } catch (error) {
    if (!stop.aborted && !isSessionEnded(error)) {
      throw error;
    }
  }
};

const followable = (row: ThreadRow): FollowedSession | null =>
  row.eveSessionId === null
    ? null
    : {
        accountId: row.accountId,
        eveSessionId: row.eveSessionId,
        eveSessionNumber: row.eveSessionNumber,
        threadId: row.id,
      };

interface RelayOptions {
  readonly lastEventId?: string | undefined;
  readonly pollMs?: number;
  readonly signal?: AbortSignal | undefined;
}

// The kept events, `caughtUp`, then what happens live, until the thread is gone or `signal` aborts.
// With no platform (no model reached) nothing is followed, but the thread still reads
const relayThread = async function* relayThread(
  platform: AgentPlatform | null,
  accountId: string,
  threadId: string,
  { lastEventId, pollMs = NEXT_SESSION_POLL_MS, signal }: RelayOptions = {},
): AsyncGenerator<ThreadStreamEvent> {
  const stop = signal ?? new AbortController().signal;
  let sent = parseCursor(lastEventId);
  const unsent = (at: ThreadPosition): boolean => sent === null || comparePositions(at, sent) > 0;
  for (;;) {
    const page = await threadHistory(accountId, { after: sent, limit: HISTORY_PAGE, threadId });
    for (const { position, row } of page) {
      sent = position;
      yield withEventMeta({ kind: "event", row }, { id: row.eventId });
    }
    if (page.length < HISTORY_PAGE) {
      break;
    }
  }
  yield withEventMeta({ kind: "caughtUp" }, { retry: RECONNECT_MS });
  let followed: string | null = null;
  while (!stop.aborted) {
    const row = await threadOf(accountId, threadId);
    if (row === null) {
      return;
    }
    const session = platform === null ? null : followable(row);
    if (platform === null || session === null || session.eveSessionId === followed) {
      // an abort ends the wait early with an AbortError: the loop then stops
      await sleep(pollMs, undefined, { signal: stop }).catch(() => null);
    } else {
      followed = session.eveSessionId;
      const startIndex = sent?.session === session.eveSessionNumber ? sent.line : 0;
      for await (const { at, event } of sessionEvents(
        platform,
        session,
        { pollMs, startIndex },
        stop,
      )) {
        if (at === null) {
          yield event;
        } else if (unsent(at)) {
          sent = at;
          yield withEventMeta(event, { id: cursorOf(at) });
        }
      }
    }
  }
};

// refused before anything streams when the thread is none of the account's
export const followThread = async (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
  options: RelayOptions,
): Promise<AsyncGenerator<ThreadStreamEvent>> => {
  if ((await threadOf(accountId, threadId)) === null) {
    throw new NotFoundError();
  }
  return relayThread(runtime?.platform ?? null, accountId, threadId, options);
};
