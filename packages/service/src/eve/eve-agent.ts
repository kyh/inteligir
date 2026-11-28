import type { AgentEvent } from "@repo/contract/library/agent-events";
import type { WebToolName } from "@repo/contract/library/agent-tools";
import { agentThread, agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { changeSet } from "@repo/db/library-schema";
import { and, desc, eq, isNull, lt, notExists } from "drizzle-orm";
import { activeTurn, call, runs } from "eve/events";
import type { AnyColumn } from "drizzle-orm";
import type { Fact, Progress, SessionView, TurnSettled } from "eve/events";
import type { ToolModelOutput } from "eve/tools";

import { sealTurnSet } from "../library/turn-sets";
import { takeLibraryHead } from "../library/library-store";
import type { TurnStop, UsageAt } from "../agent/agent-limits";
import { AGENT_TURN_STEPS, bookTurn, chargeSpend } from "../agent/agent-limits";
import { agentEnabled, filingRulesFor } from "../agent/agent-preference";
import { costMicroUsdOf, WEB_SEARCH_MICRO_USD } from "../agent/agent-model";
import type { AgentCallOutcome, AgentTool } from "./agent-tools";
import { AGENT_TOOLS, callAgentTool } from "./agent-tools";
import type { TurnAt } from "../agent/agent-threads";
import {
  keepTurn,
  moveThread,
  stampTurnStop,
  threadOf,
  turnIs,
  turnOf,
} from "../agent/agent-threads";
import { eveCallerOf } from "../agent/eve-admission";
import { shownEvent, turnEndedEvent, turnOutcomeOf } from "../agent/thread-events";
import { ownModelKey } from "../agent/model-key";

type EveAuth = Parameters<typeof eveCallerOf>[0];

export const agentTools = () => AGENT_TOOLS;

interface ToolCall {
  readonly auth: EveAuth;
  readonly eveSessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly input: unknown;
}

export const runAgentTool = async (toolCall: ToolCall, tool: AgentTool) => {
  const { accountId, eveSessionNumber, threadId } = eveCallerOf(toolCall.auth);

  const turn = await turnOf(db, {
    accountId,
    eveSessionNumber,
    eveTurnId: toolCall.turnId,
    threadId,
  });

  if (turn === null || (await threadOf(accountId, threadId)) === null) {
    return { kind: "failed", text: "This conversation was deleted." } satisfies AgentCallOutcome;
  }

  return await callAgentTool(
    { principal: { accountId, actor: { kind: "agent", threadId, turn: turn.number } } },
    tool,
    { callId: toolCall.callId, eveSessionId: toolCall.eveSessionId, input: toolCall.input },
  );
};

export const callerModelKey = async (auth: EveAuth) =>
  await ownModelKey(eveCallerOf(auth).accountId);

export const callerFilingRules = async (auth: EveAuth) =>
  await filingRulesFor(eveCallerOf(auth).accountId);

export const agentCallModelOutput = ({ kind, text }: AgentCallOutcome) =>
  (kind === "ran"
    ? { type: "text", value: text }
    : { type: "error-text", value: text }) satisfies ToolModelOutput;

interface RecordedFact {
  readonly auth: EveAuth;
  readonly event: Fact | Progress;
  readonly position: { readonly line: number; readonly index: number };
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

const startTurn = async (at: TurnAt, now: number) => {
  const { accountId, threadId } = at;
  await db.transaction(async (tx) => {
    await moveThread(tx, accountId, threadId, { status: "running", updatedAt: now });
    await keepTurn(tx, at, now);
  });
};

const settleTurn = async (
  at: TurnAt,
  position: RecordedFact["position"],
  settled: TurnSettled,
  now: number,
) => {
  const { accountId, threadId } = at;
  await db.transaction(async (tx) => {
    await moveThread(tx, accountId, threadId, { status: "idle", updatedAt: now });
    const turn = await turnOf(tx, at);

    if (turn === null) {
      return;
    }

    const [settledNow] = await tx
      .update(agentTurn)
      .set({ outcome: turnOutcomeOf(settled, turn), settledAt: now })
      .where(and(turnIs(at), isNull(agentTurn.settledAt)))
      .returning({ number: agentTurn.number });

    if (settledNow === undefined) {
      return;
    }

    await sealTurnSet(tx, accountId, { threadId, turn: turn.number }, now);
    await keepEvent(
      tx,
      { accountId, eveSessionNumber: at.eveSessionNumber, threadId, ...position },
      turnEndedEvent(settled, turn),
      now,
    );
  });
};

export const recordEveFact = async ({ at: now, auth, event, position }: RecordedFact) => {
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

const TURN_STRANDED_MS = 60 * 60 * 1000;

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

const STRANDED_BATCH = 100;

const pastKept = async (tx: Tx, at: TurnAt) => {
  const [last] = await tx
    .select({ index: agentThreadEvent.index, line: agentThreadEvent.line })
    .from(agentThreadEvent)
    .where(
      and(
        eq(agentThreadEvent.accountId, at.accountId),
        eq(agentThreadEvent.threadId, at.threadId),
        eq(agentThreadEvent.eveSessionNumber, at.eveSessionNumber),
      ),
    )
    .orderBy(desc(agentThreadEvent.line), desc(agentThreadEvent.index))
    .limit(1);

  return (
    last === undefined ? { index: 0, line: 0 } : { index: last.index + 1, line: last.line }
  ) satisfies { readonly line: number; readonly index: number };
};

const settleStranded = async (at: TurnAt, now: number) =>
  await db.transaction(async (tx) => {
    const { accountId, threadId } = at;
    await moveThread(tx, accountId, threadId, { status: "idle", updatedAt: now });

    const [settled] = await tx
      .update(agentTurn)
      .set({ outcome: "failed", settledAt: now })
      .where(and(turnIs(at), isNull(agentTurn.settledAt)))
      .returning({ number: agentTurn.number });

    if (settled === undefined) {
      return false;
    }

    const ended: AgentEvent = { reason: "failed", turn: settled.number, type: "turn.ended" };
    await keepEvent(
      tx,
      { accountId, eveSessionNumber: at.eveSessionNumber, threadId, ...(await pastKept(tx, at)) },
      ended,
      now,
    );

    return true;
  });

const idleUnheld = async (accountId: string, threadId: string, now: number) => {
  await db.transaction(async (tx) => {
    const seq = await takeLibraryHead(tx, accountId);
    await tx
      .update(agentThread)
      .set({ seq, status: "idle", updatedAt: now })
      .where(
        and(
          eq(agentThread.accountId, accountId),
          eq(agentThread.id, threadId),
          eq(agentThread.status, "running"),
          notExists(openTurnOf(agentThread.accountId, agentThread.id)),
        ),
      );
  });
};

export const settleStrandedTurns = async (now: number) => {
  const stranded = await db
    .select({
      accountId: agentTurn.accountId,
      eveSessionNumber: agentTurn.eveSessionNumber,
      eveTurnId: agentTurn.eveTurnId,
      threadId: agentTurn.threadId,
    })
    .from(agentTurn)
    .where(and(isNull(agentTurn.settledAt), lt(agentTurn.startedAt, now - TURN_STRANDED_MS)))
    .limit(STRANDED_BATCH);

  let settled = 0;

  for (const at of stranded) {
    if (await settleStranded(at, now)) {
      settled += 1;
    }
  }

  const unheld = await db
    .select({ accountId: agentThread.accountId, id: agentThread.id })
    .from(agentThread)
    .where(
      and(
        eq(agentThread.status, "running"),
        isNull(agentThread.deletedAt),
        notExists(openTurnOf(agentThread.accountId, agentThread.id)),
      ),
    )
    .limit(STRANDED_BATCH);

  for (const { accountId, id } of unheld) {
    await idleUnheld(accountId, id, now);
  }

  const sealed = await db
    .update(changeSet)
    .set({ sealedAt: now })
    .where(
      and(
        isNull(changeSet.sealedAt),
        notExists(openTurnOf(changeSet.accountId, changeSet.threadId, changeSet.turn)),
      ),
    )
    .returning({ id: changeSet.id });

  return { idled: unheld.length, sealed: sealed.length, settled } satisfies {
    readonly settled: number;
    readonly idled: number;
    readonly sealed: number;
  };
};

interface LimitedFact {
  readonly auth: EveAuth;
  readonly event: Fact;
  readonly position: { readonly line: number; readonly index: number };
  readonly at: number;
  readonly view: SessionView;
}

const stopping = async (at: TurnAt | null, stop: TurnStop | null) => {
  if (stop === null) {
    return false;
  }

  if (at !== null) {
    await stampTurnStop(db, at, stop);
  }

  return true;
};

export const limitEveFact = async ({ at: now, auth, event, position, view }: LimitedFact) => {
  const { accountId, eveSessionNumber, threadId } = eveCallerOf(auth);
  const spentAt: UsageAt = { accountId, eveSessionNumber, threadId, ...position };

  const turnAt = (eveTurnId: string | undefined) =>
    (eveTurnId === undefined
      ? null
      : { accountId, eveSessionNumber, eveTurnId, threadId }) satisfies TurnAt | null;

  switch (event.type) {
    case "turn.started": {
      const at = { accountId, eveSessionNumber, eveTurnId: event.data.turnId, threadId };

      return await db.transaction(async (tx) => {
        await keepTurn(tx, at, now);

        if (!(await agentEnabled(accountId, tx))) {
          return true;
        }

        const stop = await bookTurn(tx, spentAt, now);

        if (stop !== null) {
          await stampTurnStop(tx, at, stop);
        }

        return stop !== null;
      });
    }

    case "model.requested": {
      const { owner } = event.data;

      if (!("turnId" in owner)) {
        return false;
      }

      if (runs(view, { turnId: owner.turnId }).length > AGENT_TURN_STEPS) {
        return await stopping(turnAt(owner.turnId), "steps");
      }

      return !(await agentEnabled(accountId));
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
