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

const NEXT_SESSION_POLL_MS = 2000;

const RECONNECT_MS = 1000;

const HISTORY_PAGE = 500;

const SETTLE_POLL_MS = 100;
const SETTLE_QUICK_MS = 10_000;

interface FollowedSession {
  readonly accountId: string;
  readonly threadId: string;
  readonly eveSessionId: string;
  readonly eveSessionNumber: number;
}

const keptEnd = async (
  at: TurnAt,
  position: ThreadPosition,
  { pollMs, stop }: { readonly pollMs: number; readonly stop: AbortSignal },
) => {
  const quickUntil = Date.now() + SETTLE_QUICK_MS;

  while (!stop.aborted) {
    const turn = await turnOf(db, at);

    if (turn !== null && turn.settledAt !== null) {
      return await keptEventAt(at.accountId, at.threadId, position);
    }

    await sleep(Date.now() < quickUntil ? SETTLE_POLL_MS : pollMs, undefined, {
      signal: stop,
    }).catch(() => null);
  }

  return null;
};

const relayedRow = async (
  session: FollowedSession,
  recorded: AgentStreamEvent,
  at: ThreadPosition,
  wait: { readonly pollMs: number; readonly stop: AbortSignal },
) => {
  const { accountId, eveSessionNumber, threadId } = session;

  if (recorded.type === "turn.settled") {
    return await keptEnd(
      { accountId, eveSessionNumber, eveTurnId: recorded.data.turnId, threadId },
      at,
      wait,
    );
  }

  const event = shownEvent(recorded, eveSessionNumber);

  return (
    event === null
      ? null
      : {
          at: Date.parse(recorded.meta.at),
          event,
          eventId: cursorOf(at),
          threadId,
          type: event.type,
        }
  ) satisfies ThreadEventRow | null;
};

interface SessionEvent {
  readonly at: ThreadPosition | null;
  readonly event: ThreadStreamEvent;
}

const sessionEvents: (
  platform: AgentPlatform,
  session: FollowedSession,
  from: { readonly startIndex: number; readonly pollMs: number },
  stop: AbortSignal,
) => AsyncGenerator<SessionEvent> = async function* sessionEvents(
  platform: AgentPlatform,
  session: FollowedSession,
  from: { readonly startIndex: number; readonly pollMs: number },
  stop: AbortSignal,
) {
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

const followable = (row: ThreadRow) =>
  (row.eveSessionId === null
    ? null
    : {
        accountId: row.accountId,
        eveSessionId: row.eveSessionId,
        eveSessionNumber: row.eveSessionNumber,
        threadId: row.id,
      }) satisfies FollowedSession | null;

interface RelayOptions {
  readonly lastEventId?: string | undefined;
  readonly pollMs?: number;
  readonly signal?: AbortSignal | undefined;
}

const relayThread: (
  platform: AgentPlatform | null,
  accountId: string,
  threadId: string,
  options?: RelayOptions,
) => AsyncGenerator<ThreadStreamEvent> = async function* relayThread(
  platform: AgentPlatform | null,
  accountId: string,
  threadId: string,
  { lastEventId, pollMs = NEXT_SESSION_POLL_MS, signal }: RelayOptions = {},
) {
  const stop = signal ?? new AbortController().signal;
  let sent = parseCursor(lastEventId);
  const unsent = (at: ThreadPosition) => sent === null || comparePositions(at, sent) > 0;

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

export const followThread: (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
  options: RelayOptions,
) => Promise<AsyncGenerator<ThreadStreamEvent>> = async (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
  options: RelayOptions,
) => {
  if ((await threadOf(accountId, threadId)) === null) {
    throw new NotFoundError();
  }

  return relayThread(runtime?.platform ?? null, accountId, threadId, options);
};
