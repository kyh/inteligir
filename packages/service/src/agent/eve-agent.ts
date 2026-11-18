// What the eve agent (apps/web/agent) asks of the app, keyed by its session's caller as the channel
// admitted it (`./eve-admission`): its library tools, run as the turn, what its record hook keeps
// of each fact and what its limits hook books and charges. A turn's row is written as eve starts
// it, before its first model call, so every tool call of the turn finds its number, which its change
// set is keyed by; its settle seals that set and ends the turn in the thread, and the agent's cron
// settles one whose settle never came.

import type { AgentEvent } from "@repo/contract/library/agent-events";
import type { WebToolName } from "@repo/contract/library/agent-tools";
import { agentThread, agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { changeSet } from "@repo/db/library-schema";
import { and, eq, isNull, lt, notExists } from "drizzle-orm";
import { activeTurn, call, runs } from "eve/events";
import type { AnyColumn } from "drizzle-orm";
import type { Fact, Progress, SessionView, TurnSettled } from "eve/events";
import type { ToolModelOutput } from "eve/tools";

import { sealTurnSet } from "../library/library-change-sets";
import type { TurnStop, UsageAt } from "./agent-limits";
import { AGENT_TURN_STEPS, bookTurn, chargeSpend } from "./agent-limits";
import { costMicroUsdOf, WEB_SEARCH_MICRO_USD } from "./agent-model";
import type { AgentCallOutcome, AgentTool } from "./agent-tools";
import { AGENT_TOOLS, callAgentTool } from "./agent-tools";
import type { TurnAt } from "./agent-threads";
import { keepTurn, stampTurnStop, threadOf, turnIs, turnOf } from "./agent-threads";
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
export const runAgentTool = async (
  toolCall: ToolCall,
  tool: AgentTool,
): Promise<AgentCallOutcome> => {
  const { accountId, eveSessionNumber, threadId } = eveCallerOf(toolCall.auth);
  const turn = await turnOf(db, {
    accountId,
    eveSessionNumber,
    eveTurnId: toolCall.turnId,
    threadId,
  });
  if (turn === null || (await threadOf(accountId, threadId)) === null) {
    return { kind: "failed", text: "This conversation was deleted." };
  }
  // no kick: a tool runs in eve's step, which no request's after() keeps alive, so what its write
  // asks waits for the per-minute cron
  return await callAgentTool(
    { principal: { accountId, actor: { kind: "agent", threadId, turn: turn.number } } },
    tool,
    { callId: toolCall.callId, eveSessionId: toolCall.eveSessionId, input: toolCall.input },
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
    await keepTurn(tx, at, now);
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
    const turn = await turnOf(tx, at);
    if (turn === null) {
      return;
    }
    await tx
      .update(agentTurn)
      .set({ outcome: turnOutcomeOf(settled, turn), settledAt: now })
      .where(and(turnIs(at), isNull(agentTurn.settledAt)));
    await sealTurnSet(tx, accountId, { threadId, turn: turn.number }, now);
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

// a turn runs at most 20 model calls and their tools: one still open this long lost its settle
const TURN_STRANDED_MS = 60 * 60 * 1000;

// a thread's open turn, or the one numbered `number` while it is open
const openTurnOf = (accountId: AnyColumn, threadId: AnyColumn, number?: AnyColumn) =>
  db
    .select({ number: agentTurn.number })
    .from(agentTurn)
    .where(
      and(
        eq(agentTurn.accountId, accountId),
        eq(agentTurn.threadId, threadId),
        number === undefined ? undefined : eq(agentTurn.number, number),
        isNull(agentTurn.settledAt),
      ),
    );

// The agent's cron's backstop for a settle eve recorded but couldn't deliver: a turn stranded open
// settles failed and a thread running no turn goes idle. Every set whose turn no longer runs is
// sealed, as is one a landing made after its turn settled or whose conversation went, which Undo
// and the prune would otherwise never reach
export const settleStrandedTurns = async (
  now: number,
): Promise<{ readonly settled: number; readonly sealed: number }> =>
  await db.transaction(async (tx) => {
    const settled = await tx
      .update(agentTurn)
      .set({ outcome: "failed", settledAt: now })
      .where(and(isNull(agentTurn.settledAt), lt(agentTurn.startedAt, now - TURN_STRANDED_MS)))
      .returning({ number: agentTurn.number });
    await tx
      .update(agentThread)
      .set({ status: "idle", updatedAt: now })
      .where(
        and(
          eq(agentThread.status, "running"),
          notExists(openTurnOf(agentThread.accountId, agentThread.id)),
        ),
      );
    const sealed = await tx
      .update(changeSet)
      .set({ sealedAt: now })
      .where(
        and(
          isNull(changeSet.sealedAt),
          notExists(openTurnOf(changeSet.accountId, changeSet.threadId, changeSet.turn)),
        ),
      )
      .returning({ id: changeSet.id });
    return { sealed: sealed.length, settled: settled.length };
  });

interface LimitedFact {
  readonly auth: EveAuth;
  readonly event: Fact;
  readonly position: { readonly line: number; readonly index: number };
  readonly at: number;
  // the session as eve folded it with the fact: `ctx.view`
  readonly view: SessionView;
}

// the turn stopped by `stop`, stamped first, since eve settles a hook's cancel with no cause
const stopping = async (at: TurnAt | null, stop: TurnStop | null): Promise<boolean> => {
  if (stop === null) {
    return false;
  }
  if (at !== null) {
    await stampTurnStop(db, at, stop);
  }
  return true;
};

// What a turn may still spend, as eve records each fact that spends it: a turn booked as it
// starts, each model call counted as the turn asks for it, its tokens and each web search charged
// as eve records them. True when a limit stops the turn, which the hook then cancels; a cancel from
// `turn.started` or `model.requested` lands before that model call
export const limitEveFact = async ({
  at: now,
  auth,
  event,
  position,
  view,
}: LimitedFact): Promise<boolean> => {
  const { accountId, eveSessionNumber, threadId } = eveCallerOf(auth);
  const spentAt: UsageAt = { accountId, eveSessionNumber, threadId, ...position };
  const turnAt = (eveTurnId: string | undefined): TurnAt | null =>
    eveTurnId === undefined ? null : { accountId, eveSessionNumber, eveTurnId, threadId };
  switch (event.type) {
    case "turn.started": {
      const at = { accountId, eveSessionNumber, eveTurnId: event.data.turnId, threadId };
      return await db.transaction(async (tx) => {
        await keepTurn(tx, at, now);
        const stop = await bookTurn(tx, spentAt, now);
        if (stop !== null) {
          await stampTurnStop(tx, at, stop);
        }
        return stop !== null;
      });
    }
    case "model.requested": {
      const { owner } = event.data;
      if (!("turnId" in owner) || runs(view, { turnId: owner.turnId }).length <= AGENT_TURN_STEPS) {
        return false;
      }
      return await stopping(turnAt(owner.turnId), "steps");
    }
    case "usage.recorded": {
      if (event.data.kind !== "model") {
        return false;
      }
      const costMicroUsd = costMicroUsdOf(event.data.usage);
      const stop = await chargeSpend(spentAt, { costMicroUsd, kind: "model" }, now);
      return await stopping(turnAt(activeTurn(view)?.turnId), stop);
    }
    case "call.settled": {
      if (call(view, event.data.callId)?.name !== ("web_search" satisfies WebToolName)) {
        return false;
      }
      const costMicroUsd = WEB_SEARCH_MICRO_USD;
      const stop = await chargeSpend(spentAt, { costMicroUsd, kind: "search" }, now);
      return await stopping(turnAt(activeTurn(view)?.turnId), stop);
    }
    default: {
      return false;
    }
  }
};
