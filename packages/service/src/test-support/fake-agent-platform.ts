// Holds to `AgentPlatform`'s contract as eve documents it, so a suite against it holds for the real
// one: a create is keyed by its operationId and a message by its idempotency key, so a retry
// answers the same session and delivery; a recorded line never moves; a send answers once its
// message is taken, and its turn runs on; a message to a running turn joins it, stopping a reply
// not yet written and read at the next step otherwise; a stop ends the turn where it is; an ended
// session takes nothing more. Each fact goes to the app's hooks as eve delivers them, after its
// line is saved, with the session folded through that line, and the turn waits for them: the
// limits hook's (apps/web/agent/hooks/limits.ts) first, whose cancel stops the turn before its
// next step, then the record hook's `*`; a text delta is a line of its own, which no hook gets. A
// turn plays the mock model's script (`../agent/mock-directives`) as the mock model does
// (apps/web/agent/lib/mock-model.ts), each step a model call that runs the calls it asks for as
// eve runs the agent's tools and then reports its usage, its reply written after its wait,
// streamed in pieces before it completes.

import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import { emptySessionView, foldEvents } from "eve/events";
import type { Fact, Progress, SessionView } from "eve/events";

import { mockStep, mockUsageOf } from "../agent/mock-directives";
import type { MockStep } from "../agent/mock-directives";
import { principalOf } from "../agent/eve-admission";
import { agentTools, limitEveFact, recordEveFact, runAgentTool } from "../agent/eve-agent";
import { eveOperationId } from "../agent/eve-token";
import type {
  AgentCaller,
  AgentMessage,
  AgentPlatform,
  AgentSessionCreated,
  AgentStreamEvent,
} from "../agent/platform";
import { AgentPlatformError } from "../agent/platform";
import type { AgentRuntime } from "../agent/runtime";

// the facts the limits hook takes, by the keys it handles
const LIMITED = new Set<Fact["type"]>([
  "call.settled",
  "model.requested",
  "turn.started",
  "usage.recorded",
]);

// a reply streams in pieces this long, the first naming its part text
const DELTA_CHARS = 100;

type RecordedLine =
  | { readonly kind: "facts"; readonly at: number; readonly facts: readonly Fact[] }
  | { readonly kind: "progress"; readonly at: number; readonly progress: Progress };

interface RunningTurn {
  readonly id: string;
  readonly stop: AbortController;
  // messages sent to it since its step began, the latest read at its next step
  readonly steered: AgentMessage[];
  // aborted by a message sent to it, which stops a reply it has not begun writing
  steering: AbortController;
  done: Promise<void>;
}

interface SessionState {
  readonly caller: AgentCaller;
  readonly lines: RecordedLine[];
  readonly keys: Map<string, string>;
  readonly sent: AgentMessage[];
  // tells each open stream a line was added
  readonly added: EventTarget;
  ended: boolean;
  turn: RunningTurn | null;
}

export interface FakeAgentPlatform extends AgentPlatform {
  // delivers every recorded fact to the hook again, as eve may after an interruption
  readonly replayHooks: (sessionId: string) => Promise<void>;
  // ends the session as its idle timeout or an eve upgrade would
  readonly expire: (sessionId: string) => Promise<void>;
  readonly session: (sessionId: string) => {
    readonly caller: AgentCaller;
    readonly ended: boolean;
    readonly sent: readonly AgentMessage[];
  };
  // the eve session made for a thread's numbered session
  readonly sessionFor: (threadId: string, eveSessionNumber: number) => string | undefined;
  // every turn started so far, settled
  readonly turnsSettled: () => Promise<void>;
}

const sentText = ({ text }: AgentMessage): string => text;

const piecesOf = (text: string): string[] => {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += DELTA_CHARS) {
    pieces.push(text.slice(start, start + DELTA_CHARS));
  }
  return pieces;
};

const streamed = (line: RecordedLine, number: number): AgentStreamEvent[] => {
  const at = new Date(line.at).toISOString();
  return line.kind === "facts"
    ? line.facts.map((fact, index) => ({
        ...fact,
        meta: { at, position: { index, line: number } },
      }))
    : [{ ...line.progress, meta: { at, position: { index: 0, line: number } } }];
};

// a model call settled as eve records it, after the calls it asked for ran, its usage beside it
// with the tokens the script says
const modelSettledOf = (runId: string, turnId: string, message: string): Fact[] => [
  { data: { outcome: "completed", runId }, scope: { turnId }, type: "model.settled" },
  {
    data: {
      kind: "model",
      owner: { runId },
      usage: { cacheReadTokens: 0, cacheWriteTokens: 0, ...mockUsageOf(message) },
    },
    scope: { turnId },
    type: "usage.recorded",
  },
];

export const createFakeAgentPlatform = (): FakeAgentPlatform => {
  const sessions = new Map<string, SessionState>();
  const byOperation = new Map<string, AgentSessionCreated>();
  // a turn's line is in before its hook is done, so a turn is done once its run is
  const runs: Promise<void>[] = [];
  // thread rows key an eve session's id uniquely, and suites share a database
  const instance = randomBytes(4).toString("hex");
  let lastId = 0;
  const nextId = (prefix: string): string => {
    lastId += 1;
    return `${prefix}_fake${instance}_${String(lastId)}`;
  };

  const stateOf = (sessionId: string): SessionState => {
    const state = sessions.get(sessionId);
    if (state === undefined || state.ended) {
      throw new AgentPlatformError("ended", `Session ${sessionId} has ended`);
    }
    return state;
  };

  const viewThrough = (state: SessionState, line: number): SessionView =>
    foldEvents(
      emptySessionView(),
      state.lines.slice(0, line + 1).flatMap((each, number) => streamed(each, number)),
    );

  const deliverHooks = async (state: SessionState, line: number): Promise<void> => {
    const recorded = state.lines[line];
    if (recorded?.kind !== "facts") {
      return;
    }
    const view = viewThrough(state, line);
    const auth = principalOf({ ...state.caller, eveSessionId: null });
    for (const [index, event] of recorded.facts.entries()) {
      const delivered = { at: recorded.at, auth, event, position: { index, line } };
      if (LIMITED.has(event.type) && (await limitEveFact({ ...delivered, view }))) {
        state.turn?.stop.abort();
      }
      await recordEveFact(delivered);
    }
  };

  const record = async (sessionId: string, facts: readonly Fact[]): Promise<void> => {
    const state = stateOf(sessionId);
    state.lines.push({ at: Date.now(), facts, kind: "facts" });
    for (const fact of facts) {
      if (fact.type === "turn.settled") {
        state.turn = null;
      } else if (fact.type === "session.ended") {
        state.ended = true;
      }
    }
    state.added.dispatchEvent(new Event("line"));
    await deliverHooks(state, state.lines.length - 1);
  };

  // a fact the turn records, after whose hooks a stop ends the turn where it is
  const recordInTurn = async (
    sessionId: string,
    turn: RunningTurn,
    facts: readonly Fact[],
  ): Promise<void> => {
    await record(sessionId, facts);
    turn.stop.signal.throwIfAborted();
  };

  // a model call the turn asks for, as eve records it before calling the model
  const requestModel = async (sessionId: string, turn: RunningTurn): Promise<string> => {
    const runId = nextId("run");
    await recordInTurn(sessionId, turn, [
      {
        data: { owner: { turnId: turn.id }, runId },
        scope: { turnId: turn.id },
        type: "model.requested",
      },
    ]);
    return runId;
  };

  const recordProgress = (sessionId: string, progress: Progress): void => {
    const state = stateOf(sessionId);
    state.lines.push({ at: state.lines.at(-1)?.at ?? Date.now(), kind: "progress", progress });
    state.added.dispatchEvent(new Event("line"));
  };

  const reply = async (
    sessionId: string,
    turn: RunningTurn,
    { afterMs, text }: Extract<MockStep, { kind: "reply" }>,
  ): Promise<void> => {
    try {
      await sleep(afterMs, undefined, {
        signal: AbortSignal.any([turn.stop.signal, turn.steering.signal]),
      });
    } catch (error) {
      if (turn.stop.signal.aborted || !turn.steering.signal.aborted) {
        throw error;
      }
      return;
    }
    const partId = nextId("part");
    for (const [index, delta] of piecesOf(text).entries()) {
      recordProgress(sessionId, {
        data: index === 0 ? { delta, kind: "text", partId } : { delta, partId },
        scope: { turnId: turn.id },
        type: "content.delta",
      });
    }
    await recordInTurn(sessionId, turn, [
      {
        data: { kind: "text", partId, phase: "reply", value: text },
        scope: { turnId: turn.id },
        type: "content.completed",
      },
    ]);
  };

  const call = async (
    sessionId: string,
    turn: RunningTurn,
    { input, tool: name }: Extract<MockStep, { kind: "call" }>,
  ): Promise<void> => {
    const auth = principalOf({ ...stateOf(sessionId).caller, eveSessionId: sessionId });
    const callId = nextId("call");
    const turnId = turn.id;
    await recordInTurn(sessionId, turn, [
      {
        data: { callId, capability: { kind: "tool", name }, input, owner: { turnId } },
        scope: { turnId },
        type: "call.requested",
      },
    ]);
    const tool = agentTools().find((each) => each.name === name);
    const output =
      tool === undefined
        ? { kind: "failed", text: `There is no tool named ${name}.` }
        : await runAgentTool({ auth, callId, eveSessionId: sessionId, input, turnId }, tool);
    await recordInTurn(sessionId, turn, [
      { data: { callId, outcome: "completed", output }, scope: { turnId }, type: "call.settled" },
    ]);
  };

  // the mock model's turn: a step per call, then its reply, each step reading the latest message
  // that joined since the last
  const play = async (sessionId: string, turn: RunningTurn, message: string): Promise<void> => {
    turn.stop.signal.throwIfAborted();
    let latest = message;
    let step = 0;
    for (;;) {
      const steered = turn.steered.splice(0).at(-1);
      if (steered !== undefined) {
        latest = sentText(steered);
        step = 0;
        turn.steering = new AbortController();
      }
      const runId = await requestModel(sessionId, turn);
      const next = mockStep(latest, step);
      if (next.kind === "call") {
        await call(sessionId, turn, next);
        step += 1;
      } else {
        await reply(sessionId, turn, next);
      }
      await recordInTurn(sessionId, turn, modelSettledOf(runId, turn.id, latest));
      if (next.kind === "reply" && turn.steered.length === 0) {
        await record(sessionId, [
          { data: { outcome: "completed", turnId: turn.id }, type: "turn.settled" },
        ]);
        return;
      }
    }
  };

  // a stop lands where the turn waits, and settles it cancelled
  const runTurn = async (sessionId: string, turn: RunningTurn, message: string): Promise<void> => {
    try {
      await play(sessionId, turn, message);
    } catch (error) {
      if (!turn.stop.signal.aborted) {
        throw error;
      }
      await record(sessionId, [
        { data: { outcome: "cancelled", turnId: turn.id }, type: "turn.settled" },
      ]);
    }
  };

  const deliver = async (sessionId: string, message: AgentMessage): Promise<string> => {
    const state = stateOf(sessionId);
    const kept =
      message.idempotencyKey === undefined ? undefined : state.keys.get(message.idempotencyKey);
    if (kept !== undefined) {
      return kept;
    }
    state.sent.push(message);
    const deliveryId = nextId("dlv");
    if (message.idempotencyKey !== undefined) {
      state.keys.set(message.idempotencyKey, deliveryId);
    }
    const running = state.turn;
    const turnId = running?.id ?? nextId("turn");
    const consumed: Fact = {
      data: { deliveryId, parts: [{ kind: "text", text: sentText(message) }], turnId },
      type: "delivery.consumed",
    };
    if (running !== null) {
      running.steered.push(message);
      running.steering.abort();
      await record(sessionId, [consumed]);
      return deliveryId;
    }
    const turn: RunningTurn = {
      done: Promise.resolve(),
      id: turnId,
      steered: [],
      steering: new AbortController(),
      stop: new AbortController(),
    };
    state.turn = turn;
    await record(sessionId, [
      { data: { cause: { deliveryId }, follows: null, turnId }, type: "turn.started" },
      consumed,
    ]);
    turn.done = runTurn(sessionId, turn, sentText(message));
    runs.push(turn.done);
    return deliveryId;
  };

  const stopTurn = async (sessionId: string): Promise<void> => {
    const running = stateOf(sessionId).turn;
    if (running !== null) {
      running.stop.abort();
      await running.done;
    }
  };

  const end = async (sessionId: string): Promise<void> => {
    await stopTurn(sessionId);
    await record(sessionId, [{ data: { outcome: "completed" }, type: "session.ended" }]);
  };

  return {
    cancel: async (_caller, sessionId) => {
      await stopTurn(sessionId);
    },

    createSession: async (caller, message) => {
      const operationId = eveOperationId(caller.threadId, caller.eveSessionNumber);
      const made = byOperation.get(operationId);
      if (made !== undefined) {
        return made;
      }
      const sessionId = nextId("sess");
      sessions.set(sessionId, {
        added: new EventTarget(),
        caller,
        ended: false,
        keys: new Map(),
        lines: [],
        sent: [],
        turn: null,
      });
      await record(sessionId, [{ data: {}, type: "session.started" }]);
      const created = { deliveryId: await deliver(sessionId, message), sessionId };
      byOperation.set(operationId, created);
      return created;
    },

    end: async (_caller, sessionId) => {
      const state = sessions.get(sessionId);
      if (state === undefined || state.ended) {
        return "gone";
      }
      await end(sessionId);
      return "ended";
    },

    expire: end,

    replayHooks: async (sessionId) => {
      const state = sessions.get(sessionId);
      for (const [line] of (state?.lines ?? []).entries()) {
        if (state !== undefined) {
          await deliverHooks(state, line);
        }
      }
    },

    send: async (_caller, sessionId, message) => await deliver(sessionId, message),

    session: (sessionId) => {
      const state = sessions.get(sessionId);
      if (state === undefined) {
        throw new Error(`No session ${sessionId}`);
      }
      return { caller: state.caller, ended: state.ended, sent: [...state.sent] };
    },

    sessionFor: (threadId, eveSessionNumber) =>
      byOperation.get(eveOperationId(threadId, eveSessionNumber))?.sessionId,

    stream: (_caller, sessionId, { signal, startIndex }) => ({
      [Symbol.asyncIterator]: async function* events() {
        const state = sessions.get(sessionId);
        if (state === undefined) {
          throw new AgentPlatformError("ended", `Session ${sessionId} has ended`);
        }
        let next = startIndex;
        while (!signal.aborted) {
          const line = state.lines[next];
          if (line !== undefined) {
            yield* streamed(line, next);
            next += 1;
          } else if (state.ended) {
            return;
          } else {
            try {
              await once(state.added, "line", { signal });
            } catch {
              // the reader left: the loop ends on its signal
            }
          }
        }
      },
    }),

    turnsSettled: async () => {
      while (runs.length > 0) {
        await Promise.all(runs.splice(0));
      }
    },
  };
};

interface FakeAgentRuntime {
  readonly runtime: AgentRuntime;
  // the background work started so far, done
  readonly settled: () => Promise<void>;
}

// a runtime over the fake, whose background work the suite awaits
export const fakeAgentRuntime = (platform: FakeAgentPlatform): FakeAgentRuntime => {
  const pending: Promise<void>[] = [];
  return {
    runtime: {
      background: (task) => {
        pending.push(task());
      },
      platform,
    },
    settled: async () => {
      await Promise.all(pending.splice(0));
    },
  };
};
