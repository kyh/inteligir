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
  purgeTried,
  retiredThreads,
  retireThread,
  startedSession,
  threadOf,
} from "./agent-threads";
import type { AgentCaller, AgentMessage, AgentPlatform } from "./platform";
import { AgentPlatformError, isSessionEnded } from "./platform";
import type { AgentRuntime } from "./runtime";

const TITLE_MAX_CHARS = 80;

const EVE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const threadAnswerSchema = z.object({ status: z.enum(THREAD_STATUSES), threadId: z.string() });

type ThreadAnswer = z.infer<typeof threadAnswerSchema>;

const callerOf = (row: ThreadRow, eveSessionNumber = row.eveSessionNumber) =>
  ({
    accountId: row.accountId,
    eveSessionNumber,
    threadId: row.id,
  }) satisfies AgentCaller;

const outlived = (row: ThreadRow, now: number) =>
  row.status === "idle" &&
  row.eveSessionStartedAt !== null &&
  now - row.eveSessionStartedAt >= EVE_SESSION_MAX_AGE_MS;

const titleOf = (text: string) => {
  const line = text.trim().split("\n", 1)[0] ?? "";

  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…` : line;
};

const platformRefusal = (cause: unknown) => {
  if (!(cause instanceof AgentPlatformError)) {
    return (
      cause instanceof Error ? cause : new Error("The agent's call failed.", { cause })
    ) satisfies Error;
  }

  console.error({ event: "agent-platform-failed", ...errorFields(cause) });

  return (
    cause.failure === "refused" ? new NotFoundError() : new AgentUnavailableError()
  ) satisfies Error;
};

const refusingPlatformFailures = async <T>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (error) {
    throw platformRefusal(error);
  }
};

const requireRuntime = (runtime: AgentRuntime | null) => {
  if (runtime === null) {
    throw new AgentUnavailableError();
  }

  return runtime;
};

const rotate = async (
  runtime: AgentRuntime,
  superseded: ThreadRow,
  message: AgentMessage,
  now: number,
) =>
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
) => {
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

export const sendToAgent = async (
  runtime: AgentRuntime | null,
  accountId: string,
  input: SendInput,
) => {
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

export const cancelAgentTurn = async (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
) => {
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

  return { status: after?.status ?? "idle", threadId } satisfies ThreadAnswer;
};

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

export const setAgentEnabled = async (
  runtime: AgentRuntime | null,
  writer: LibraryWriter,
  input: { readonly enabled: boolean; readonly opId?: string | undefined },
) => {
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

type PurgeOutcome = "purged" | "kept" | "failed";

const purgeRetired = async (platform: AgentPlatform | null, row: ThreadRow) => {
  const { eveSessionId } = row;

  if (eveSessionId !== null) {
    if (platform === null) {
      return "kept" as const;
    }

    await platform.end(callerOf(row), eveSessionId);
  }

  await purgeThreadRow(row);

  return "purged" as const;
};

export const deleteAgentThread = async (
  runtime: AgentRuntime | null,
  accountId: string,
  threadId: string,
) => {
  const row = await retireThread(accountId, threadId, Date.now());

  if (row === null) {
    throw new NotFoundError();
  }

  if (runtime !== null) {
    runtime.background(async () => {
      await purgeRetired(runtime.platform, row);
    }, `purge deleted thread ${row.id}`);
  }

  return { deleted: true } satisfies { deleted: true };
};

const PURGE_BATCH = 10;

export const purgeRetiredThreads = async (runtime: AgentRuntime | null, now = Date.now()) => {
  const rows = await retiredThreads(PURGE_BATCH);

  const outcomes = await Promise.all(
    rows.map(async (row) => {
      let outcome: PurgeOutcome = "failed";

      try {
        outcome = await purgeRetired(runtime?.platform ?? null, row);
      } catch (error) {
        console.error({ event: "agent-purge-failed", threadId: row.id, ...errorFields(error) });
      }

      if (outcome !== "purged") {
        await purgeTried(row, now);
      }

      return outcome;
    }),
  );

  const tally = { failed: 0, kept: 0, purged: 0 };

  for (const outcome of outcomes) {
    tally[outcome] += 1;
  }

  return tally;
};

export const agentStatus = async (accountId: string, now: number) => ({
  enabled: await agentEnabled(accountId),
  resetsAt: nextDayAt(now),
  turnsLeft: await turnsLeftToday(accountId, now),
});
