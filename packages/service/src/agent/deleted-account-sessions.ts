import { agentDeletedAccountSession, agentThread } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { and, asc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { errorFields } from "../log";
import { EVE_SESSION_IDLE_MS } from "./agent-model";
import type { AgentPlatform } from "./platform";
import type { AgentRuntime } from "./runtime";

type KeptSession = typeof agentDeletedAccountSession.$inferSelect;

export const keepDeletedAccountSessions = async (accountId: string, now: number) => {
  const threads = await db
    .select({
      eveSessionId: agentThread.eveSessionId,
      eveSessionNumber: agentThread.eveSessionNumber,
      threadId: agentThread.id,
    })
    .from(agentThread)
    .where(
      and(
        eq(agentThread.accountId, accountId),
        isNotNull(agentThread.eveSessionId),
        gte(agentThread.updatedAt, now - EVE_SESSION_IDLE_MS),
      ),
    );

  const kept = threads.flatMap(({ eveSessionId, ...thread }) =>
    eveSessionId === null ? [] : [{ ...thread, accountId, eveSessionId, keptAt: now }],
  );

  if (kept.length > 0) {
    await db.insert(agentDeletedAccountSession).values(kept).onConflictDoNothing();
  }
};

type Ending = "ended" | "kept" | "failed";

const isKept = (row: KeptSession) => eq(agentDeletedAccountSession.eveSessionId, row.eveSessionId);

const endKept = async (platform: AgentPlatform | null, row: KeptSession) => {
  if (platform === null) {
    return "kept" as const;
  }

  const { accountId, eveSessionId, eveSessionNumber, threadId } = row;
  await platform.end({ accountId, eveSessionNumber, threadId }, eveSessionId);
  await db.delete(agentDeletedAccountSession).where(isKept(row));

  return "ended" as const;
};

const endEach = async (runtime: AgentRuntime | null, rows: readonly KeptSession[], now: number) => {
  const outcomes = await Promise.all(
    rows.map(async (row) => {
      let outcome: Ending = "failed";

      try {
        outcome = await endKept(runtime?.platform ?? null, row);
      } catch (error) {
        console.error({
          event: "agent-session-end-failed",
          threadId: row.threadId,
          ...errorFields(error),
        });
      }

      if (outcome !== "ended") {
        await db.update(agentDeletedAccountSession).set({ triedAt: now }).where(isKept(row));
      }

      return outcome;
    }),
  );

  const tally = { ended: 0, failed: 0, kept: 0 };

  for (const outcome of outcomes) {
    tally[outcome] += 1;
  }

  return tally;
};

export const endDeletedAccountSessions = async (
  runtime: AgentRuntime | null,
  accountId: string,
  now = Date.now(),
) => {
  try {
    const rows = await db
      .select()
      .from(agentDeletedAccountSession)
      .where(eq(agentDeletedAccountSession.accountId, accountId));

    await endEach(runtime, rows, now);
  } catch (error) {
    console.error({ event: "agent-account-sessions-failed", ...errorFields(error) });
  }
};

const CRON_BATCH = 10;

export const retryDeletedAccountSessions = async (
  runtime: AgentRuntime | null,
  now = Date.now(),
) => {
  const rows = await db
    .select()
    .from(agentDeletedAccountSession)
    .orderBy(
      sql`${agentDeletedAccountSession.triedAt} asc nulls first`,
      asc(agentDeletedAccountSession.keptAt),
    )
    .limit(CRON_BATCH);

  return await endEach(runtime, rows, now);
};
