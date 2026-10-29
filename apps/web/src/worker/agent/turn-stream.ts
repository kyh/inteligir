// The account's running turn, read off its session's stream while the cell stays up for it
// (`ctx.waitUntil`, at most fifteen minutes past the call that began it), in windows of fourteen
// minutes, each closed at the session's next idle: an approval it waits on, or its end. The stream
// is opened first and the session's events since the last one stored are listed after, so no event
// falls between the two; every buffered event is stored by its `sevt_` id before the account's
// sockets hear it, so one met twice is stored once, and the agent's message is relayed as it is
// written, folded from its deltas, a preview no pull ever carries
// (platform.claude.com/docs/en/managed-agents/events-and-streaming). A turn ends only once
// `sessions.retrieve` shows its session at rest; then it seals, and the next send waiting starts.
// No timer runs here: a window ends at an event, and the turn's reconcile, the cell's alarm,
// answers for a stream that ends without one.

import { accumulateManagedAgentsEvent } from "@anthropic-ai/sdk/lib/sessions/accumulate";
import type { AccumulatedEvent } from "@anthropic-ai/sdk/lib/sessions/accumulate";
import type { BetaManagedAgentsSessionEvent } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { z } from "zod";

import { AGENT_TURN_PHASES } from "@repo/notes/library/library-schema";

import type { AgentCell } from "./agent-access";
import { repairAgentAccess } from "./agent-access";
import { callFailureFields, isGone } from "./managed-agents";
import type { ManagedAgents } from "./managed-agents";
import { ASK_AGAIN } from "./turn-calls";
import { LISTED_TYPES, roleOf } from "./turn-events";
import type { StreamEvent, ThreadEventRow } from "./turn-events";
import { openTurn, sessionRow } from "./turn-rows";
import type { OpenTurn } from "./turn-rows";
import { startOpenTurn, undoStart } from "./turn-start";
import { absorbEvent, landTurn, sealTurn, turnStateOf } from "./turn-state";
import type { TurnState } from "./turn-state";

// a window of the stream, under the fifteen minutes a cell is kept up for it
const WINDOW_MS = 14 * 60_000;
// what one transaction of a reconcile keeps of the events it lists
const LIST_PAGE = 100;

export interface TurnWhere {
  readonly threadId: string;
  readonly sessionId: string;
}

const stateSchema = z.enum([...AGENT_TURN_PHASES, "gone"]);

// a credential Anthropic could not use, repaired while the turn goes on
const repairMeanwhile = async (cell: AgentCell): Promise<void> => {
  try {
    await repairAgentAccess(cell);
  } catch (error) {
    console.warn({ event: "agent-repair-failed", ...callFailureFields(error) });
  }
};

// events kept in one transaction, each relayed once it is, and the turn's state after them
const absorbAll = async (
  cell: AgentCell,
  where: TurnWhere,
  events: readonly StreamEvent[],
): Promise<TurnState> => {
  const kept: ThreadEventRow[] = [];
  let repair = false;
  const landed = await landTurn(cell, { answer: stateSchema, opId: undefined }, (scope) => {
    kept.length = 0;
    for (const event of events) {
      const absorbed = absorbEvent(scope, where, event);
      if (absorbed !== null) {
        kept.push(absorbed.row);
        repair ||= absorbed.signal.kind === "repair";
      }
    }
    return turnStateOf(scope.storage, where.sessionId);
  });
  if (!landed.ok) {
    return "gone";
  }
  for (const row of kept) {
    cell.tell({ event: row.event, preview: false, threadId: where.threadId, type: "thread" });
  }
  if (repair) {
    cell.waitUntil(repairMeanwhile(cell));
  }
  return landed.value;
};

// the session's events since the last one stored, listed and kept: what a stream opened late, or
// one that broke, did not carry
export const catchUp = async (
  cell: AgentCell,
  agents: ManagedAgents,
  where: TurnWhere,
): Promise<TurnState> => {
  const cursor = cell.library.read((sql) => sessionRow(sql, where.sessionId)?.cursor ?? null);
  let state = cell.library.read((sql) => turnStateOf(sql, where.sessionId));
  let last: TurnState = state.ok ? state.value : "gone";
  let batch: BetaManagedAgentsSessionEvent[] = [];
  try {
    for await (const event of agents.client.beta.sessions.events.list(
      where.sessionId,
      {
        "created_at[gte]": cursor.ok && cursor.value !== null ? cursor.value : undefined,
        limit: LIST_PAGE,
        order: "asc",
        types: [...LISTED_TYPES],
      },
      ASK_AGAIN,
    )) {
      batch.push(event);
      if (batch.length >= LIST_PAGE) {
        last = await absorbAll(cell, where, batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      last = await absorbAll(cell, where, batch);
    }
  } catch (error) {
    console.warn({ event: "agent-events-list-failed", ...callFailureFields(error) });
    state = cell.library.read((sql) => turnStateOf(sql, where.sessionId));
    return state.ok ? state.value : "gone";
  }
  return last;
};

// the turn handed to a send that waited, started; one that does not start goes back to the head of
// the queue, which asks again a minute on
export const startQueued = async (cell: AgentCell, agents: ManagedAgents): Promise<boolean> => {
  const started = await startOpenTurn(cell, agents, "first");
  if (started.kind === "failed") {
    await undoStart(cell, started, { opId: undefined, requeueAs: cell.library.ids.queuedSend() });
    return false;
  }
  return started.kind === "started";
};

const nextSchema = z.string().nullable();

// the ending turn sealed once its session is at rest, and the turn handed on, true once the next
// send's turn started; a session still running or rescheduling is asked again by the turn's
// reconcile
export const confirmEnd = async (
  cell: AgentCell,
  agents: ManagedAgents,
  turn: Pick<OpenTurn, "threadId" | "turn" | "sessionId">,
): Promise<boolean> => {
  if (turn.sessionId === null) {
    return false;
  }
  try {
    const session = await agents.client.beta.sessions.retrieve(turn.sessionId, {}, ASK_AGAIN);
    if (session.status === "running" || session.status === "rescheduling") {
      return false;
    }
  } catch (error) {
    if (!isGone(error)) {
      console.warn({ event: "agent-session-retrieve-failed", ...callFailureFields(error) });
      return false;
    }
  }
  const next = await landTurn(cell, { answer: nextSchema, opId: undefined }, (scope) =>
    sealTurn(scope, turn),
  );
  return next.ok && next.value !== null && (await startQueued(cell, agents));
};

type Window = "again" | "rest";

// a preview of the agent's message as it is written, for the sockets alone
const relayPreview = (cell: AgentCell, threadId: string, preview: AccumulatedEvent): void => {
  cell.tell({ event: z.json().parse(preview), preview: true, threadId, type: "thread" });
};

// what follows a window: a turn that ends is confirmed and sealed, the next send's turn read next;
// one that waits rests until its answer, and one still running reads its next window when this one
// carried anything
const afterWindow = async (
  cell: AgentCell,
  agents: ManagedAgents,
  turn: OpenTurn,
  state: TurnState,
  carried: boolean,
): Promise<Window> => {
  if (state === "ending") {
    return (await confirmEnd(cell, agents, turn)) ? "again" : "rest";
  }
  return state === "running" && carried ? "again" : "rest";
};

// the stream read until the turn stops running or the window closes: each event kept and relayed
// as it comes, each preview relayed alone
const readWindow = async (
  cell: AgentCell,
  stream: AsyncIterable<StreamEvent>,
  where: TurnWhere,
  opened: number,
): Promise<{ readonly state: TurnState; readonly carried: boolean }> => {
  let state: TurnState = "running";
  let carried = false;
  let preview: AccumulatedEvent | undefined;
  for await (const event of stream) {
    carried = true;
    if (roleOf(event.type) === "preview") {
      preview = accumulateManagedAgentsEvent(preview, event);
      if (preview !== undefined) {
        relayPreview(cell, where.threadId, preview);
      }
    } else {
      if (event.type === "agent.message" || event.type === "span.model_request_end") {
        preview = undefined;
      }
      state = await absorbAll(cell, where, [event]);
    }
    if (state !== "running" || cell.now() - opened >= WINDOW_MS) {
      break;
    }
  }
  return { carried, state };
};

// one window of the open turn's stream
const driveWindow = async (cell: AgentCell, agents: ManagedAgents): Promise<Window> => {
  const read = cell.library.read(openTurn);
  const turn = read.ok ? read.value : null;
  if (turn?.sessionId === null || turn === null) {
    return "rest";
  }
  if (turn.phase === "ending") {
    return (await confirmEnd(cell, agents, turn)) ? "again" : "rest";
  }
  if (turn.phase !== "running") {
    return "rest";
  }
  const where = { sessionId: turn.sessionId, threadId: turn.threadId };
  const opened = cell.now();
  let stream: Awaited<ReturnType<typeof agents.client.beta.sessions.events.stream>>;
  try {
    stream = await agents.client.beta.sessions.events.stream(
      where.sessionId,
      { event_deltas: ["agent.message"] },
      { maxRetries: 0 },
    );
  } catch (error) {
    console.warn({ event: "agent-stream-open-failed", ...callFailureFields(error) });
    return "rest";
  }
  try {
    const caught = await catchUp(cell, agents, where);
    const window = caught === "running" ? await readWindow(cell, stream, where, opened) : null;
    return await afterWindow(cell, agents, turn, window?.state ?? caught, window?.carried ?? false);
  } finally {
    stream.controller.abort();
  }
};

const driveWhileAsked = async (cell: AgentCell, agents: ManagedAgents): Promise<void> => {
  const { driver } = cell;
  try {
    do {
      driver.again = false;
      if ((await driveWindow(cell, agents)) === "again") {
        driver.again = true;
      }
    } while (driver.again);
  } catch (error) {
    console.error({ event: "agent-turn-drive-failed", ...callFailureFields(error) });
  } finally {
    driver.driving = false;
  }
};

// the open turn's stream read while the cell stays up for it; asked while one is read, the reader
// reads one more window once this one ends
export const kickTurn = (cell: AgentCell): void => {
  const { agents, driver } = cell;
  if (agents === null) {
    return;
  }
  if (driver.driving) {
    driver.again = true;
    return;
  }
  driver.driving = true;
  cell.waitUntil(driveWhileAsked(cell, agents));
};
