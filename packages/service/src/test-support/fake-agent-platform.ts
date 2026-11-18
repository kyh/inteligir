// Holds to `AgentPlatform`'s contract as eve documents it, so a suite against it holds for the real
// one: a create is keyed by its operationId and a message by its idempotency key, so a retry
// answers the same session and delivery; a recorded line and its facts never move; a message to a
// running turn joins it; an ended session takes nothing more. Each fact goes to the hook as eve's
// `*` hook gets it, after its line is saved, and the turn waits for it. A turn plays the mock
// model's script (`../agent/mock-directives`), running each call as eve runs the agent's tool.

import { randomBytes } from "node:crypto";

import type { Fact } from "eve/events";

import { mockStep } from "../agent/mock-directives";
import type { EvePrincipal } from "../agent/eve-admission";
import { principalOf } from "../agent/eve-admission";
import { agentTools, runAgentTool } from "../agent/eve-agent";
import { eveOperationId } from "../agent/eve-token";
import type {
  AgentCaller,
  AgentMessage,
  AgentPlatform,
  AgentSessionCreated,
} from "../agent/platform";
import { AgentPlatformError } from "../agent/platform";
import type { AgentRuntime } from "../agent/runtime";

interface FakeHookCall {
  readonly auth: EvePrincipal;
  readonly event: Fact;
  readonly position: { readonly line: number; readonly index: number };
}

type FakeHook = (call: FakeHookCall) => Promise<void>;

interface RecordedLine {
  readonly facts: readonly Fact[];
}

interface SessionState {
  readonly caller: AgentCaller;
  readonly lines: RecordedLine[];
  readonly keys: Map<string, string>;
  readonly sent: AgentMessage[];
  ended: boolean;
  turnId: string | null;
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
}

const sentText = ({ text }: AgentMessage): string => text;

export const createFakeAgentPlatform = (hook: FakeHook): FakeAgentPlatform => {
  const sessions = new Map<string, SessionState>();
  const byOperation = new Map<string, AgentSessionCreated>();
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

  const deliverHooks = async (state: SessionState, line: number): Promise<void> => {
    const facts = state.lines[line]?.facts ?? [];
    for (const [index, event] of facts.entries()) {
      await hook({
        auth: principalOf({ ...state.caller, eveSessionId: null }),
        event,
        position: { index, line },
      });
    }
  };

  const record = async (sessionId: string, facts: readonly Fact[]): Promise<void> => {
    const state = stateOf(sessionId);
    state.lines.push({ facts });
    for (const fact of facts) {
      if (fact.type === "turn.started") {
        state.turnId = fact.data.turnId;
      } else if (fact.type === "turn.settled") {
        state.turnId = null;
      } else if (fact.type === "session.ended") {
        state.ended = true;
      }
    }
    await deliverHooks(state, state.lines.length - 1);
  };

  // the mock model's turn, its calls run as eve runs the agent's tools
  const play = async (sessionId: string, turnId: string, message: string): Promise<void> => {
    const state = stateOf(sessionId);
    const auth = principalOf({ ...state.caller, eveSessionId: sessionId });
    for (let step = 0; ; step += 1) {
      const next = mockStep(message, step);
      if (next.kind === "reply") {
        await record(sessionId, [
          {
            data: { kind: "text", partId: nextId("part"), phase: "reply", value: next.text },
            scope: { turnId },
            type: "content.completed",
          },
        ]);
        await record(sessionId, [{ data: { outcome: "completed", turnId }, type: "turn.settled" }]);
        return;
      }
      const callId = nextId("call");
      await record(sessionId, [
        {
          data: {
            callId,
            capability: { kind: "tool", name: next.tool },
            input: next.input,
            owner: { turnId },
          },
          scope: { turnId },
          type: "call.requested",
        },
      ]);
      const tool = agentTools().find(({ name }) => name === next.tool);
      const output =
        tool === undefined
          ? { kind: "failed", text: `There is no tool named ${next.tool}.` }
          : await runAgentTool(
              { auth, callId, eveSessionId: sessionId, input: next.input, turnId },
              tool,
            );
      await record(sessionId, [
        {
          data: { callId, outcome: "completed", output },
          scope: { turnId },
          type: "call.settled",
        },
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
    const steering = state.turnId;
    const turnId = steering ?? nextId("turn");
    const consumed: Fact = {
      data: { deliveryId, parts: [{ kind: "text", text: sentText(message) }], turnId },
      type: "delivery.consumed",
    };
    if (steering !== null) {
      await record(sessionId, [consumed]);
      return deliveryId;
    }
    await record(sessionId, [
      { data: { cause: { deliveryId }, follows: null, turnId }, type: "turn.started" },
      consumed,
    ]);
    await play(sessionId, turnId, sentText(message));
    return deliveryId;
  };

  const end = async (sessionId: string): Promise<void> => {
    await record(sessionId, [{ data: { outcome: "completed" }, type: "session.ended" }]);
  };

  return {
    cancel: async (_caller, sessionId) => {
      const state = stateOf(sessionId);
      if (state.turnId !== null) {
        await record(sessionId, [
          { data: { outcome: "cancelled", turnId: state.turnId }, type: "turn.settled" },
        ]);
      }
    },

    createSession: async (caller, message) => {
      const operationId = eveOperationId(caller.threadId, caller.eveSessionNumber);
      const made = byOperation.get(operationId);
      if (made !== undefined) {
        return made;
      }
      const sessionId = nextId("sess");
      sessions.set(sessionId, {
        caller,
        ended: false,
        keys: new Map(),
        lines: [],
        sent: [],
        turnId: null,
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
