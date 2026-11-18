// What the eve agent (apps/web/agent) asks of the app, keyed by its session's caller as the channel
// admitted it (`./eve-admission`): its library tools, run as the turn, and what its record hook
// keeps of each fact. A turn's row is written as eve starts it, before its first model call, so
// every tool call of the turn finds its number, which its change set is keyed by; its settle seals
// that set and ends the turn in the thread.

import type { AgentEvent } from "@repo/contract/library/agent-events";
import { agentThread, agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Fact, Progress, TurnSettled } from "eve/events";
import type { ToolModelOutput } from "eve/tools";

import { sealTurnSet } from "../library/library-change-sets";
import type { AgentCallOutcome, AgentTool } from "./agent-tools";
import { AGENT_TOOLS, callAgentTool } from "./agent-tools";
import type { TurnAt } from "./agent-threads";
import { threadOf, turnIs, turnNumberOf } from "./agent-threads";
import { eveCallerOf } from "./eve-admission";
import { shownEvent, turnEndedEvent, turnOutcomeOf } from "./thread-events";

// the session's caller as eve hands it back: `ctx.session.auth.current`
type EveAuth = Parameters<typeof eveCallerOf>[0];

export const agentTools = (): readonly AgentTool[] => AGENT_TOOLS;

// a call as eve hands it to the tool, its input as the model wrote it
interface ToolCall {
  readonly auth: EveAuth;
  readonly eveSessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly input: unknown;
}

// read afresh at every call, so a deleted thread's turn changes nothing more
export const runAgentTool = async (call: ToolCall, tool: AgentTool): Promise<AgentCallOutcome> => {
  const { accountId, eveSessionNumber, threadId } = eveCallerOf(call.auth);
  const turn = await turnNumberOf(db, {
    accountId,
    eveSessionNumber,
    eveTurnId: call.turnId,
    threadId,
  });
  if (turn === null || (await threadOf(accountId, threadId)) === null) {
    return { kind: "failed", text: "This conversation was deleted." };
  }
  return await callAgentTool(
    { principal: { accountId, actor: { kind: "agent", threadId, turn } } },
    tool,
    { callId: call.callId, eveSessionId: call.eveSessionId, input: call.input },
  );
};

// what the model reads of a call: its text, as an error's unless the call ran
export const agentCallModelOutput = ({ kind, text }: AgentCallOutcome): ToolModelOutput =>
  kind === "ran" ? { type: "text", value: text } : { type: "error-text", value: text };

interface RecordedFact {
  readonly auth: EveAuth;
  // a `*` hook gets a fact's progress too, which a thread never keeps
  readonly event: Fact | Progress;
  // where eve recorded it in its session: `ctx.position`
  readonly position: { readonly line: number; readonly index: number };
  // when eve recorded it, unix milliseconds: `ctx.now`, which the relay reads as its line's time
  readonly at: number;
}

interface EventAt {
  readonly accountId: string;
  readonly threadId: string;
  readonly eveSessionNumber: number;
  readonly line: number;
  readonly index: number;
}

const keepEvent = async (executor: DbExecutor, at: EventAt, event: AgentEvent, now: number) => {
  await executor
    .insert(agentThreadEvent)
    .values({ ...at, at: now, event, type: event.type })
    .onConflictDoNothing();
};

const startTurn = async (at: TurnAt, now: number): Promise<void> => {
  const { accountId, threadId } = at;
  await db.transaction(async (tx) => {
    await tx
      .insert(agentTurn)
      .values({
        ...at,
        number: sql`(select coalesce(max(${agentTurn.number}), 0) + 1 from ${agentTurn} where ${agentTurn.accountId} = ${accountId} and ${agentTurn.threadId} = ${threadId})`,
        startedAt: now,
      })
      .onConflictDoNothing({
        target: [
          agentTurn.accountId,
          agentTurn.threadId,
          agentTurn.eveSessionNumber,
          agentTurn.eveTurnId,
        ],
      });
    await tx
      .update(agentThread)
      .set({ status: "running", updatedAt: now })
      .where(and(eq(agentThread.accountId, accountId), eq(agentThread.id, threadId)));
  });
};

const settleTurn = async (
  at: TurnAt,
  position: RecordedFact["position"],
  settled: TurnSettled,
  now: number,
): Promise<void> => {
  const { accountId, threadId } = at;
  await db.transaction(async (tx) => {
    const turn = await turnNumberOf(tx, at);
    if (turn === null) {
      return;
    }
    await tx
      .update(agentTurn)
      .set({ outcome: turnOutcomeOf(settled), settledAt: now })
      .where(and(turnIs(at), isNull(agentTurn.settledAt)));
    await sealTurnSet(tx, accountId, { threadId, turn }, now);
    await keepEvent(
      tx,
      { accountId, eveSessionNumber: at.eveSessionNumber, threadId, ...position },
      turnEndedEvent(settled, turn),
      now,
    );
    await tx
      .update(agentThread)
      .set({ status: "idle", updatedAt: now })
      .where(and(eq(agentThread.accountId, accountId), eq(agentThread.id, threadId)));
  });
};

// One fact of a thread's eve session, kept as the thread shows it at the place eve recorded it, so
// a hook delivered twice writes once; a turn's start and settle move its row and the thread's
export const recordEveFact = async ({
  at: now,
  auth,
  event,
  position,
}: RecordedFact): Promise<void> => {
  const { accountId, eveSessionNumber, threadId } = eveCallerOf(auth);
  if ((await threadOf(accountId, threadId)) === null) {
    return;
  }
  switch (event.type) {
    case "turn.started": {
      await startTurn({ accountId, eveSessionNumber, eveTurnId: event.data.turnId, threadId }, now);
      return;
    }
    case "turn.settled": {
      await settleTurn(
        { accountId, eveSessionNumber, eveTurnId: event.data.turnId, threadId },
        position,
        event,
        now,
      );
      return;
    }
    default: {
      const shown = shownEvent(event, eveSessionNumber);
      if (shown !== null) {
        await keepEvent(db, { accountId, eveSessionNumber, threadId, ...position }, shown, now);
      }
    }
  }
};
