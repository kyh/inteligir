// A thread runs on one eve session at a time. When that one has ended (idle too long, or stranded
// by an eve upgrade) or is a week old, its next message starts the next, which begins from that
// message alone.

import { AgentUnavailableError, NotFoundError } from "@repo/contract/rpc/v1-errors";
import { THREAD_STATUSES } from "@repo/contract/library/library-wire";
import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import { agentThread } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { opAnswer } from "@repo/db/library-schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { answer } from "../library/library-access";
import { mintLibraryId } from "../library/library-ids";
import { priorAnswer, writeLibrary } from "../library/library-store";
import type { LibraryWriter } from "../library/library-store";
import { errorFields } from "../log";
import { nextDayAt, refuseSendPastLimits, turnsLeftToday } from "./agent-limits";
import { agentEnabled, switchedSchema, writeAgentEnabled } from "./agent-preference";
import type { ThreadRow } from "./agent-threads";
import {
  openThread,
  purgeThreadRow,
  retiredThreads,
  retireThread,
  startedSession,
  threadOf,
} from "./agent-threads";
import type { AgentCaller, AgentMessage, AgentPlatform } from "./platform";
import { AgentPlatformError, isSessionEnded } from "./platform";
import type { AgentRuntime } from "./runtime";

const TITLE_MAX_CHARS = 80;

// eve records a session's events on the Vercel deployment that started it for as long as the
// session lives, and Vercel deletes a production deployment 30 days on, once 20 newer exist: a
// week's age plus eve's week of idle (apps/web/agent/agent.ts) keeps every session well inside
const EVE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const threadAnswerSchema = z.object({ status: z.enum(THREAD_STATUSES), threadId: z.string() });

type ThreadAnswer = z.infer<typeof threadAnswerSchema>;

const callerOf = (row: ThreadRow, eveSessionNumber = row.eveSessionNumber): AgentCaller => ({
  accountId: row.accountId,
  eveSessionNumber,
  threadId: row.id,
});

// only between turns, so a running turn is never cut off: a message to it steers it
const outlived = (row: ThreadRow, now: number): boolean =>
  row.status === "idle" &&
  row.eveSessionStartedAt !== null &&
  now - row.eveSessionStartedAt >= EVE_SESSION_MAX_AGE_MS;

const titleOf = (text: string): string => {
  const line = text.trim().split("\n", 1)[0] ?? "";
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…` : line;
};

// a failure of eve's in the words the row declares: a deleted thread is none, and anything else
// the agent unreachable
const platformRefusal = (cause: unknown): Error => {
  if (!(cause instanceof AgentPlatformError)) {
    return cause instanceof Error ? cause : new Error("The agent's call failed.", { cause });
  }
  console.error({ error: cause, event: "agent-platform-failed" });
  return cause.failure === "refused" ? new NotFoundError() : new AgentUnavailableError();
};

const refusingPlatformFailures = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw platformRefusal(error);
  }
};

const requireRuntime = (runtime: AgentRuntime | null): AgentRuntime => {
  if (runtime === null) {
    throw new AgentUnavailableError();
  }
  return runtime;
};

// One message at a time starts a thread's next eve session: eve answers a repeated create with the
// session it made, without that message. The lock is the transaction's own, so the new session's
// hooks, writing the thread's row, never wait on it. The superseded session is ended after the
// response
const rotate = async (
  runtime: AgentRuntime,
  superseded: ThreadRow,
  message: AgentMessage,
  now: number,
): Promise<ThreadRow> =>
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${superseded.accountId}:${superseded.id}`}))`,
    );
    const row = await threadOf(superseded.accountId, superseded.id, tx);
    if (row === null) {
      throw new NotFoundError();
    }
    if (row.eveSessionNumber !== superseded.eveSessionNumber && row.eveSessionId !== null) {
      await runtime.platform.send(callerOf(row), row.eveSessionId, message);
      return row;
    }
    const number = row.eveSessionId === null ? row.eveSessionNumber : row.eveSessionNumber + 1;
    const caller = callerOf(row, number);
    const { sessionId } = await runtime.platform.createSession(caller, message);
    const started = await startedSession(tx, row, { id: sessionId, now, number });
    if (started === null) {
      runtime.background(async () => {
        await runtime.platform.end(caller, sessionId);
      }, `end the eve session made for deleted thread ${row.id}`);
      throw new NotFoundError();
    }
    const { eveSessionId } = row;
    if (eveSessionId !== null) {
      runtime.background(async () => {
        await runtime.platform.end(callerOf(row), eveSessionId);
      }, `end the superseded eve session of thread ${row.id}`);
    }
    return started;
  });

const deliver = async (
  runtime: AgentRuntime,
  row: ThreadRow,
  message: AgentMessage,
  now: number,
): Promise<ThreadRow> => {
  if (row.eveSessionId !== null && !outlived(row, now)) {
    try {
      await runtime.platform.send(callerOf(row), row.eveSessionId, message);
      return row;
    } catch (error) {
      if (!isSessionEnded(error)) {
        throw error;
      }
    }
  }
  return await rotate(runtime, row, message, now);
};

interface SendInput {
  readonly opId?: string | undefined;
  readonly text: string;
  readonly threadId?: string | undefined;
  readonly viewContext?: z.infer<typeof agentViewContextSchema> | undefined;
}

// A message to the thread it names, or the first of a new one, refused while the person keeps the
// agent off. One that would start a turn is refused while the day's limits are spent; one sent to a
// running turn joins it, booking nothing.
// A delivered message's op id answers a resend as it answered, whatever the limits say since; a new
// thread takes the op id as its own, so a first message sent again finds the thread it opened and
// eve the session that thread created, and eve delivers a later one once under it
export const sendToAgent = async (
  runtime: AgentRuntime | null,
  accountId: string,
  input: SendInput,
): Promise<ThreadAnswer> => {
  const live = requireRuntime(runtime);
  const { opId } = input;
  const prior =
    opId === undefined ? null : await priorAnswer(db, accountId, opId, threadAnswerSchema);
  if (prior !== null) {
    return prior.value;
  }
  if (!(await agentEnabled(accountId))) {
    throw new AgentUnavailableError();
  }
  const now = Date.now();
  const named = input.threadId === undefined ? null : await threadOf(accountId, input.threadId);
  if (input.threadId !== undefined && named === null) {
    throw new NotFoundError();
  }
  if (named?.status !== "running") {
    await refuseSendPastLimits(accountId, now);
  }
  const row =
    named ??
    (await openThread(accountId, {
      id: opId ?? mintLibraryId(now),
      now,
      title: titleOf(input.text),
    }));
  if (row === null) {
    throw new NotFoundError();
  }
  const delivered = await refusingPlatformFailures(
    async () =>
      await deliver(
        live,
        row,
        { clientContext: input.viewContext, idempotencyKey: opId, text: input.text },
        now,
      ),
  );
  const sent: ThreadAnswer = { status: "running", threadId: delivered.id };
  if (opId !== undefined) {
    await db
      .insert(opAnswer)
      .values({ accountId, answer: sent, at: now, opId })
      .onConflictDoNothing();
  }
  return sent;
};

// stops the thread's running turn; an ended session has none to stop
export const cancelAgentTurn = async (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
): Promise<ThreadAnswer> => {
  const { platform } = requireRuntime(runtime);
  const row = await threadOf(accountId, threadId);
  if (row === null) {
    throw new NotFoundError();
  }
  const { eveSessionId } = row;
  if (eveSessionId !== null) {
    await refusingPlatformFailures(async () => {
      try {
        await platform.cancel(callerOf(row), eveSessionId);
      } catch (error) {
        if (!isSessionEnded(error)) {
          throw error;
        }
      }
    });
  }
  const after = await threadOf(accountId, threadId);
  return { status: after?.status ?? "idle", threadId };
};

// Every turn the account runs stopped, as a stop of each does. One that can't be stopped now is
// logged, and stops before its next model call all the same, which reads the switch
// (`./eve-agent`)
const stopRunningTurns = async (runtime: AgentRuntime | null, accountId: string) => {
  const running = await db
    .select()
    .from(agentThread)
    .where(
      and(
        eq(agentThread.accountId, accountId),
        eq(agentThread.status, "running"),
        isNull(agentThread.deletedAt),
      ),
    );
  await Promise.all(
    running.map(async (row) => {
      const { eveSessionId } = row;
      if (runtime === null || eveSessionId === null) {
        return;
      }
      try {
        await runtime.platform.cancel(callerOf(row), eveSessionId);
      } catch (error) {
        if (!isSessionEnded(error)) {
          console.error({ event: "agent-stop-failed", threadId: row.id, ...errorFields(error) });
        }
      }
    }),
  );
};

// The person's switch: off stops every turn the account runs and refuses its sends until it is on
// again, and its threads stay readable. A resend of an off answers as it did, and stops what runs
// only while the agent is still off
export const setAgentEnabled = async (
  runtime: AgentRuntime | null,
  writer: LibraryWriter,
  input: { readonly enabled: boolean; readonly opId?: string | undefined },
): Promise<z.output<typeof switchedSchema>> => {
  const switched = answer(
    await writeLibrary(
      writer,
      { answer: switchedSchema, opId: input.opId },
      async (scope) => await writeAgentEnabled(scope, input.enabled),
    ),
  );
  if (!(await agentEnabled(writer.accountId))) {
    await stopRunningTurns(runtime, writer.accountId);
  }
  return switched;
};

// A deleted thread's eve session ended, then its row, its events and turns with it: "kept" while its
// session can't be ended now, for the agent's cron to retry. A session already gone counts as ended
type PurgeOutcome = "purged" | "kept" | "failed";

const purgeRetired = async (
  platform: AgentPlatform | null,
  row: ThreadRow,
): Promise<Exclude<PurgeOutcome, "failed">> => {
  const { eveSessionId } = row;
  if (eveSessionId !== null) {
    if (platform === null) {
      return "kept";
    }
    await platform.end(callerOf(row), eveSessionId);
  }
  await purgeThreadRow(row);
  return "purged";
};

// read by nothing from now, the thread is purged after the response, or by the agent's cron where
// that fails
export const deleteAgentThread = async (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
): Promise<{ deleted: true }> => {
  const row = await retireThread(accountId, threadId, Date.now());
  if (row === null) {
    throw new NotFoundError();
  }
  if (runtime !== null) {
    runtime.background(async () => {
      await purgeRetired(runtime.platform, row);
    }, `purge deleted thread ${row.id}`);
  }
  return { deleted: true };
};

// the deleted threads a cron run purges, each ending an eve session
const PURGE_BATCH = 10;

// the deleted threads whose purge after their response failed, each alone: one that fails again is
// logged and tried by the next run
export const purgeRetiredThreads = async (
  runtime: AgentRuntime | null,
): Promise<Record<PurgeOutcome, number>> => {
  const rows = await retiredThreads(PURGE_BATCH);
  const outcomes = await Promise.all(
    rows.map(async (row): Promise<PurgeOutcome> => {
      try {
        return await purgeRetired(runtime?.platform ?? null, row);
      } catch (error) {
        console.error({ event: "agent-purge-failed", threadId: row.id, ...errorFields(error) });
        return "failed";
      }
    }),
  );
  const tally = { failed: 0, kept: 0, purged: 0 };
  for (const outcome of outcomes) {
    tally[outcome] += 1;
  }
  return tally;
};

// whether the person keeps the agent on, and what is left of the day's allowance
export const agentStatus = async (accountId: string, now: number) => ({
  enabled: await agentEnabled(accountId),
  resetsAt: nextDayAt(now),
  turnsLeft: await turnsLeftToday(accountId, now),
});
