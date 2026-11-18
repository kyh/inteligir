// The eve sessions of an account being deleted. eve runs each on Vercel past the rows the delete
// takes by cascade, so Better Auth's beforeDelete keeps them before the account's row goes, the
// deletion ends them once it has (`../auth/delete-account`), and the agent's cron ends any that
// couldn't be then (`./agent-cron`).

import { agentDeletedAccountSession, agentThread } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { and, asc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { errorFields } from "../log";
import { EVE_SESSION_IDLE_MS } from "./agent-model";
import type { AgentPlatform } from "./platform";
import type { AgentRuntime } from "./runtime";

type KeptSession = typeof agentDeletedAccountSession.$inferSelect;

// A thread's row moves as its session starts and as each of its turns settles, each after eve
// restarts the session's idle count, so a session whose thread stood still past eve's idle week
// has ended on its own and is not kept
export const keepDeletedAccountSessions = async (accountId: string, now: number): Promise<void> => {
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

// what a try did to a kept session: ended, or found gone, and forgotten; kept while the deployment
// reaches no agent; or failed
type Ending = "ended" | "kept" | "failed";

const isKept = (row: KeptSession) => eq(agentDeletedAccountSession.eveSessionId, row.eveSessionId);

const endKept = async (
  platform: AgentPlatform | null,
  row: KeptSession,
): Promise<Exclude<Ending, "failed">> => {
  if (platform === null) {
    return "kept";
  }
  const { accountId, eveSessionId, eveSessionNumber, threadId } = row;
  await platform.end({ accountId, eveSessionNumber, threadId }, eveSessionId);
  await db.delete(agentDeletedAccountSession).where(isKept(row));
  return "ended";
};

// each alone: one left is logged when it failed and stamped tried, for the cron to try after those
// not tried since
const endEach = async (
  runtime: AgentRuntime | null,
  rows: readonly KeptSession[],
  now: number,
): Promise<Record<Ending, number>> => {
  const outcomes = await Promise.all(
    rows.map(async (row): Promise<Ending> => {
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

// Once the account's row is gone, every session its delete kept, ended at once. The account is
// deleted whatever this does, so a failure is logged and left to the cron
export const endDeletedAccountSessions = async (
  runtime: AgentRuntime | null,
  accountId: string,
  now = Date.now(),
): Promise<void> => {
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

// the kept sessions a cron run ends, each a call to the agent
const CRON_BATCH = 10;

// the cron's: those never tried first, then those tried longest ago, so a few that keep failing
// never starve the rest
export const retryDeletedAccountSessions = async (
  runtime: AgentRuntime | null,
  now = Date.now(),
): Promise<Record<Ending, number>> => {
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
