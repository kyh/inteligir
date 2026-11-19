import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import { emptySessionView, foldEvents } from "eve/events";
import type { Fact, Progress } from "eve/events";

import { mockStep, mockUsageOf } from "../agent/mock-directives";
import type { MockStep } from "../agent/mock-directives";
import { principalOf } from "../agent/eve-admission";
import {
  agentTools,
  callerFilingRules,
  limitEveFact,
  recordEveFact,
  runAgentTool,
} from "../agent/eve-agent";
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

const LIMITED = new Set<Fact["type"]>([
  "call.settled",
  "model.requested",
  "turn.started",
  "usage.recorded",
]);

const DELTA_CHARS = 100;

type RecordedLine =
  | { readonly kind: "facts"; readonly at: number; readonly facts: readonly Fact[] }
  | { readonly kind: "progress"; readonly at: number; readonly progress: Progress };

interface RunningTurn {
  readonly id: string;
  readonly stop: AbortController;
  readonly steered: AgentMessage[];
  steering: AbortController;
  done: Promise<void>;
}

interface SessionState {
  readonly caller: AgentCaller;
  readonly lines: RecordedLine[];
  readonly keys: Map<string, string>;
  readonly sent: AgentMessage[];
  readonly added: EventTarget;
  ended: boolean;
  turn: RunningTurn | null;
}

export interface FakeAgentPlatform extends AgentPlatform {
  readonly replayHooks: (sessionId: string) => Promise<void>;
  readonly holdHooks: (type: Fact["type"]) => () => Promise<void>;
  readonly expire: (sessionId: string) => Promise<void>;
  readonly session: (sessionId: string) => {
    readonly caller: AgentCaller;
    readonly ended: boolean;
    readonly sent: readonly AgentMessage[];
  };
  readonly sessionFor: (threadId: string, eveSessionNumber: number) => string | undefined;
  readonly turnsSettled: () => Promise<void>;
}

const sentText = ({ text }: AgentMessage) => text;

const screenOf = ({ clientContext }: AgentMessage) =>
  clientContext === undefined ? null : JSON.stringify(clientContext);

const piecesOf = (text: string) => {
  const pieces: string[] = [];

  for (let start = 0; start < text.length; start += DELTA_CHARS) {
    pieces.push(text.slice(start, start + DELTA_CHARS));
  }

  return pieces;
};

const streamed: (line: RecordedLine, number: number) => AgentStreamEvent[] = (
  line: RecordedLine,
  number: number,
) => {
  const at = new Date(line.at).toISOString();

  return (
    line.kind === "facts"
      ? line.facts.map((fact, index) => ({
          ...fact,
          meta: { at, position: { index, line: number } },
        }))
      : [{ ...line.progress, meta: { at, position: { index: 0, line: number } } }]
  ) satisfies AgentStreamEvent[];
};

const modelSettledOf = (runId: string, turnId: string, message: string) =>
  [
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
  ] satisfies Fact[];

export const createFakeAgentPlatform = () => {
  const sessions = new Map<string, SessionState>();
  const byOperation = new Map<string, AgentSessionCreated>();
  const runs: Promise<void>[] = [];
  const instance = randomBytes(4).toString("hex");
  let lastId = 0;

  const nextId = (prefix: string) => {
    lastId += 1;

    return `${prefix}_fake${instance}_${String(lastId)}`;
  };

  const stateOf = (sessionId: string) => {
    const state = sessions.get(sessionId);

    if (state === undefined || state.ended) {
      throw new AgentPlatformError("ended", `Session ${sessionId} has ended`);
    }

    return state;
  };

  const viewThrough = (state: SessionState, line: number) =>
    foldEvents(
      emptySessionView(),
      state.lines.slice(0, line + 1).flatMap((each, number) => streamed(each, number)),
    );

  const deliverHooks = async (state: SessionState, line: number) => {
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

  interface HookHold {
    readonly type: Fact["type"];
    line: { readonly state: SessionState; readonly line: number } | null;
  }

  const holds = new Set<HookHold>();

  const record = async (sessionId: string, facts: readonly Fact[]) => {
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
    const line = state.lines.length - 1;

    const hold = [...holds].find(
      (open) => open.line === null && facts.some(({ type }) => type === open.type),
    );

    if (hold !== undefined) {
      hold.line = { line, state };

      return;
    }

    await deliverHooks(state, line);
  };

  const recordInTurn = async (sessionId: string, turn: RunningTurn, facts: readonly Fact[]) => {
    await record(sessionId, facts);
    turn.stop.signal.throwIfAborted();
  };

  const requestModel = async (sessionId: string, turn: RunningTurn) => {
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

  const recordProgress = (sessionId: string, progress: Progress) => {
    const state = stateOf(sessionId);
    state.lines.push({ at: state.lines.at(-1)?.at ?? Date.now(), kind: "progress", progress });
    state.added.dispatchEvent(new Event("line"));
  };

  const reply = async (
    sessionId: string,
    turn: RunningTurn,
    { afterMs, text }: Extract<MockStep, { kind: "reply" }>,
  ) => {
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
  ) => {
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

  const play = async (sessionId: string, turn: RunningTurn, message: AgentMessage) => {
    turn.stop.signal.throwIfAborted();
    let latest = message;
    let step = 0;

    for (;;) {
      const steered = turn.steered.splice(0).at(-1);

      if (steered !== undefined) {
        latest = steered;
        step = 0;
        turn.steering = new AbortController();
      }

      const runId = await requestModel(sessionId, turn);

      const rules = await callerFilingRules(
        principalOf({ ...stateOf(sessionId).caller, eveSessionId: null }),
      );

      const next = mockStep(sentText(latest), step, { rules, screen: screenOf(latest) });

      if (next.kind === "call") {
        await call(sessionId, turn, next);
        step += 1;
      } else {
        await reply(sessionId, turn, next);
      }

      await recordInTurn(sessionId, turn, modelSettledOf(runId, turn.id, sentText(latest)));

      if (next.kind === "reply" && turn.steered.length === 0) {
        await record(sessionId, [
          { data: { outcome: "completed", turnId: turn.id }, type: "turn.settled" },
        ]);

        return;
      }
    }
  };

  const runTurn = async (sessionId: string, turn: RunningTurn, message: AgentMessage) => {
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

  const deliver = async (sessionId: string, message: AgentMessage) => {
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
    turn.done = runTurn(sessionId, turn, message);
    runs.push(turn.done);

    return deliveryId;
  };

  const stopTurn = async (sessionId: string) => {
    const running = stateOf(sessionId).turn;

    if (running !== null) {
      running.stop.abort();
      await running.done;
    }
  };

  const end = async (sessionId: string) => {
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

    holdHooks: (type) => {
      const hold: HookHold = { line: null, type };
      holds.add(hold);

      return async () => {
        holds.delete(hold);

        if (hold.line !== null) {
          await deliverHooks(hold.line.state, hold.line.line);
        }
      };
    },

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
            await Promise.allSettled([once(state.added, "line", { signal })]);
          }
        }
      },
    }),

    turnsSettled: async () => {
      while (runs.length > 0) {
        await Promise.all(runs.splice(0));
      }
    },
  } satisfies FakeAgentPlatform;
};

interface FakeAgentRuntime {
  readonly runtime: AgentRuntime;
  readonly settled: () => Promise<void>;
}

export const fakeAgentRuntime = (platform: FakeAgentPlatform) => {
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
  } satisfies FakeAgentRuntime;
};
