// A claimed turn started at Anthropic. A thread whose session still runs continues it: the session's
// budget is set again for this turn, then the person's message is sent. A thread with no session,
// or one whose session ended, gets a fresh one, made with the account's vault, a budget, its title
// and `{ accountId, threadId }` as metadata; its first message rides the create as its initial
// event, or, when the library keeps filing rules, a send of its own beside them, since a system
// message is not an initial event (platform.claude.com/docs/en/managed-agents/sessions). A start the
// platform cut short is started again by the turn's reconcile, which first looks for what the last
// attempt made and said, so a session is made once and a message said once.

import type { SqlStatements } from "@repo/notes/library/library-sql";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsSystemMessageEventParams,
  BetaManagedAgentsUserMessageEventParams,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { z } from "zod";

import { connectorAuth } from "../connector/connector-auth";
import type { AgentCell } from "./agent-access";
import { agentVaultId } from "./agent-access";
import { allowanceOf, budgetOf, centsLeft, turnCap } from "./agent-allowance";
import type { Allowance } from "./agent-allowance";
import { isGone, callFailureFields } from "./managed-agents";
import type { ManagedAgents } from "./managed-agents";
import { sessionAgent } from "./session-agent";
import {
  ASK_AGAIN,
  createSessionOnce,
  findMadeSession,
  interruptSession,
  sendEventsOnce,
  sessionSaw,
} from "./turn-calls";
import { messageTextOf } from "./turn-events";
import { filingRules, turnUserMessage } from "./turn-message";
import {
  holdSession,
  openTurn,
  sessionRow,
  setThreadSession,
  setTurnRunning,
  setTurnSession,
  threadState,
} from "./turn-rows";
import type { OpenTurn } from "./turn-rows";
import { landTurn, letSessionGo, RECONCILE_EVERY_MS, TURN_JOB, unclaimTurn } from "./turn-state";
import { scheduleJob } from "../library/cell-jobs";

// how a start is asked: by the call that claimed it, or again by a reconcile after one was cut
// short, which looks for what that one did before doing it again
export type StartMode = "first" | "again";

export type StartOutcome =
  | { readonly kind: "started" }
  // nothing to start: no turn waits on its start, another start finished it, or the thread went
  | { readonly kind: "none" }
  // it did not land; `made` is the session this attempt made, which the turn's undoing lets go
  | { readonly kind: "failed"; readonly made: string | null };

const NONE: StartOutcome = { kind: "none" };

interface StartPlan {
  readonly turn: OpenTurn;
  readonly title: string;
  readonly vaultId: string | null;
  readonly centsLeft: number;
  // the session's list cost as the ledger last booked it
  readonly consumedCents: number;
  readonly freshMessage: BetaManagedAgentsUserMessageEventParams;
  readonly nextMessage: BetaManagedAgentsUserMessageEventParams;
  readonly rules: BetaManagedAgentsSystemMessageEventParams | null;
}

const planOf = (sql: SqlStatements, allowance: Allowance, now: number): StartPlan | null => {
  const turn = openTurn(sql);
  const thread = turn === null ? null : threadState(sql, turn.threadId);
  if (turn?.phase !== "starting" || thread === null) {
    return null;
  }
  return {
    centsLeft: centsLeft(sql, allowance, now),
    consumedCents: turn.sessionId === null ? 0 : (sessionRow(sql, turn.sessionId)?.cost_cents ?? 0),
    freshMessage: turnUserMessage(sql, turn, true),
    nextMessage: turnUserMessage(sql, turn, false),
    rules: filingRules(sql),
    title: thread.title,
    turn,
    vaultId: agentVaultId(sql),
  };
};

const centsOf = (cost: { readonly amount: string } | null | undefined): number =>
  cost === null || cost === undefined ? 0 : Number(cost.amount);

// the person's message as the session holds it once sent: its last text block is what they wrote
const sawMessage = (turn: OpenTurn) => ({
  matches: (event: { readonly type: string }) =>
    event.type === "user.message" && messageTextOf(z.json().parse(event)) === turn.message.text,
  since: turn.startedAt,
  type: "user.message" as const,
});

type Continued = "sent" | "failed" | "ended";

// the thread's own session, its budget set again for this turn, then the message sent; one
// Anthropic no longer holds, or that ended, is ended
const continueSession = async (
  agents: ManagedAgents,
  plan: StartPlan,
  ceilingCents: number,
  sessionId: string,
  mode: StartMode,
): Promise<Continued> => {
  const { sessions } = agents.client.beta;
  try {
    const session = await sessions.retrieve(sessionId, {}, ASK_AGAIN);
    if (session.status === "terminated") {
      return "ended";
    }
    if (mode === "again" && (await sessionSaw(agents, sessionId, sawMessage(plan.turn)))) {
      return "sent";
    }
    if (session.budget !== null && session.budget !== undefined) {
      const consumedCents = Math.max(plan.consumedCents, centsOf(session.usage.list_cost));
      await sessions.update(
        sessionId,
        {
          budget: budgetOf(
            turnCap({ ceilingCents, consumedCents, remainingCents: plan.centsLeft }),
          ),
        },
        ASK_AGAIN,
      );
    }
  } catch (error) {
    if (isGone(error)) {
      return "ended";
    }
    console.warn({ event: "agent-session-continue-failed", ...callFailureFields(error) });
    return "failed";
  }
  return (await sendEventsOnce(agents, sessionId, [plan.nextMessage], sawMessage(plan.turn)))
    ? "sent"
    : "failed";
};

const heldAnswer = z.boolean();

// a fresh session for the thread, held on its rows before anything else is asked of it, then its
// first message sent beside the filing rules when it did not ride the create
const freshSession = async (
  cell: AgentCell,
  agents: ManagedAgents,
  plan: StartPlan & { readonly vaultId: string },
  ceilingCents: number,
  mode: StartMode,
): Promise<StartOutcome> => {
  const { turn } = plan;
  const owner = { accountId: cell.accountId, threadId: turn.threadId };
  const found = mode === "again" ? await findMadeSession(agents, owner, turn.startedAt) : null;
  const params: Anthropic.Beta.Sessions.SessionCreateParams = {
    agent: sessionAgent(agents.agent, connectorAuth(cell.env).origin),
    budget: budgetOf(turnCap({ ceilingCents, consumedCents: 0, remainingCents: plan.centsLeft })),
    environment_id: agents.environmentId,
    metadata: owner,
    title: plan.title,
    vault_ids: [plan.vaultId],
  };
  // the message rides the create unless filing rules must go beside it
  if (plan.rules === null) {
    params.initial_events = [plan.freshMessage];
  }
  const made = found ?? (await createSessionOnce(agents, params, { owner, since: turn.startedAt }));
  if (made === null) {
    return { kind: "failed", made: null };
  }
  const held = await landTurn(cell, { answer: heldAnswer, opId: undefined }, (scope) => {
    const now = openTurn(scope.storage);
    const thread = threadState(scope.storage, turn.threadId);
    if (now?.phase !== "starting" || now.threadId !== turn.threadId || thread === null) {
      holdSession(scope, made, turn.threadId);
      letSessionGo(scope, turn.threadId, made);
      return false;
    }
    holdSession(scope, made, turn.threadId);
    setTurnSession(scope.storage, made);
    setThreadSession(scope, turn.threadId, made);
    return true;
  });
  if (!held.ok || !held.value) {
    return NONE;
  }
  if (plan.rules === null && found === null) {
    return { kind: "started" };
  }
  if (found !== null && (await sessionSaw(agents, made, sawMessage(turn)))) {
    return { kind: "started" };
  }
  const events = plan.rules === null ? [plan.freshMessage] : [plan.freshMessage, plan.rules];
  return (await sendEventsOnce(agents, made, events, sawMessage(turn)))
    ? { kind: "started" }
    : { kind: "failed", made };
};

const runningAnswer = z.object({ interrupted: z.boolean(), sessionId: z.string() }).nullable();

// the turn running, its reconcile asked for; a cancel that came while it started is sent now
const markRunning = async (
  cell: AgentCell,
  agents: ManagedAgents,
  turn: OpenTurn,
): Promise<StartOutcome> => {
  const marked = await landTurn(cell, { answer: runningAnswer, opId: undefined }, (scope) => {
    const now = openTurn(scope.storage);
    if (
      now?.phase !== "starting" ||
      now.sessionId === null ||
      now.threadId !== turn.threadId ||
      now.turn !== turn.turn
    ) {
      return null;
    }
    setTurnRunning(scope.storage);
    scheduleJob(scope.storage, TURN_JOB, scope.now + RECONCILE_EVERY_MS);
    return { interrupted: now.interrupted, sessionId: now.sessionId };
  });
  if (!marked.ok || marked.value === null) {
    return NONE;
  }
  if (marked.value.interrupted) {
    await interruptSession(agents, marked.value.sessionId);
  }
  return { kind: "started" };
};

// the open turn started, if it waits on its start
export const startOpenTurn = async (
  cell: AgentCell,
  agents: ManagedAgents,
  mode: StartMode,
): Promise<StartOutcome> => {
  const allowance = allowanceOf(cell.env);
  const read = cell.library.read((sql) => planOf(sql, allowance, cell.now()));
  if (!read.ok || read.value === null) {
    return NONE;
  }
  const plan = read.value;
  const { turn, vaultId } = plan;
  if (vaultId === null) {
    return { kind: "failed", made: null };
  }
  if (turn.sessionId !== null) {
    const continued = await continueSession(
      agents,
      plan,
      allowance.turnCents,
      turn.sessionId,
      mode,
    );
    if (continued === "failed") {
      return { kind: "failed", made: null };
    }
    if (continued === "sent") {
      return await markRunning(cell, agents, turn);
    }
    // the session ended: the thread is seeded into a fresh one
    const ended = turn.sessionId;
    await landTurn(cell, { answer: heldAnswer, opId: undefined }, (scope) => {
      letSessionGo(scope, turn.threadId, ended);
      if (openTurn(scope.storage)?.sessionId === ended) {
        setTurnSession(scope.storage, null);
      }
      return true;
    });
    return await startOpenTurn(cell, agents, mode);
  }
  const fresh = await freshSession(cell, agents, { ...plan, vaultId }, allowance.turnCents, mode);
  return fresh.kind === "started" ? await markRunning(cell, agents, turn) : fresh;
};

// a turn whose start did not land, taken back: the person's own call is answered that the agent
// cannot be reached, and its message goes with it; a send that waited goes back to the queue's
// head, its next try a minute on
export const undoStart = async (
  cell: AgentCell,
  failed: { readonly made: string | null },
  undo: { readonly requeueAs: string | null; readonly opId: string | undefined },
): Promise<void> => {
  await landTurn(cell, { answer: heldAnswer, opId: undefined }, (scope) => {
    unclaimTurn(scope, { made: failed.made, opId: undo.opId, requeueAs: undo.requeueAs });
    return true;
  });
};
