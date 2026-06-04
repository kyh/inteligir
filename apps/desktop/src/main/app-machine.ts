// ---------------------------------------------------------------------------
// App state machine — serialized async queue, injectable deps + broadcast.
// ---------------------------------------------------------------------------

import { Agent } from "@/agent/agent";
import { isLoggedIn, login } from "@/agent/auth";
import { isSetupComplete, seedResources, teardownResources } from "@/agent/setup";
import { sendDispatchResponse } from "@/main/dispatch/dispatch-client";
import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import { reduce } from "@/main/app-reducer";
import { runEffect, type EffectDeps } from "@/main/app-effects";
import { broadcast } from "@/main/lib/broadcast";
import { getNotifications } from "@/main/notifications";
import { getTaskManager } from "@/main/tasks/task-manager";
import { downloadModel } from "@/main/voice/model-download";
import { parseAgentEvent } from "@/shared/agent-event-parser";
import type { AppAgentEvent } from "@/shared/agent-events";
import type { AppState, MachineEvent } from "@/shared/app-state";

// ---------------------------------------------------------------------------
// Agent singleton — runs in the main process
// ---------------------------------------------------------------------------

let agent: Agent | null = null;

// Mutable per-turn scratchpad. `assistantText` is tracked directly because
// session.getLastAssistantText() returns the *previous* turn's text after an
// early abort. The flags drive the empty-turn detection below.
type Turn = {
  startedAt: number;
  assistantText: string | null;
  sawAssistantText: boolean;
  sawToolCall: boolean;
  sawError: boolean;
};
let turn: Turn | null = null;

function startTurn(): void {
  turn = {
    startedAt: Date.now(),
    assistantText: null,
    sawAssistantText: false,
    sawToolCall: false,
    sawError: false,
  };
}

/** Compact, single-line dump of an agent event for the dev terminal. Pretty-
 * printing every field would flood the log; we keep just the discriminators
 * and the few fields needed to triage "what did the LLM actually do?". */
function logAgentEvent(event: AppAgentEvent): void {
  const dt = turn ? `+${Date.now() - turn.startedAt}ms` : "";
  switch (event.type) {
    case "agent_start":
      console.log(`[agent-event] agent_start`);
      break;
    case "agent_end":
      console.log(`[agent-event] agent_end ${dt}`);
      break;
    case "message_start":
      console.log(`[agent-event] message_start role=${event.role} ${dt}`);
      break;
    case "message_end": {
      const text = event.text ?? "";
      const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      console.log(
        `[agent-event] message_end role=${event.role} stop=${event.stopReason ?? "?"} len=${text.length} ${dt} ${preview ? `text="${preview}"` : ""}`.trim(),
      );
      break;
    }
    case "tool_execution_start":
      console.log(`[agent-event] tool_execution_start name=${event.toolName} ${dt}`);
      break;
    case "tool_execution_end":
      console.log(
        `[agent-event] tool_execution_end ok=${!event.isError} len=${event.resultText.length} ${dt}`,
      );
      break;
    case "turn_error":
      console.log(`[agent-event] turn_error kind=${event.kind} reason="${event.reason}" ${dt}`);
      break;
    default:
      console.log(`[agent-event] ${event.type} ${dt}`);
  }
}

function handleAgentEvent(event: AppAgentEvent): void {
  logAgentEvent(event);

  if (event.type === "message_end" && event.stopReason === "error") {
    console.error("[agent] error event:", event);
  }

  switch (event.type) {
    case "agent_start":
      startTurn();
      machine?.ingest({ type: "AGENT_START" });
      break;
    case "tool_execution_start":
      if (turn) turn.sawToolCall = true;
      break;
    case "message_end":
      if (turn && event.role === "assistant") {
        if (event.text) {
          turn.assistantText = event.text;
          turn.sawAssistantText = true;
        }
        if (event.stopReason === "error") turn.sawError = true;
      }
      break;
    case "agent_end": {
      // Empty-turn fallback: pi finished a turn without producing any
      // assistant text, any tool call, or an explicit stopReason: "error".
      // Almost always an upstream/auth failure swallowed as a success.
      if (turn && !turn.sawAssistantText && !turn.sawToolCall && !turn.sawError) {
        const elapsed = Date.now() - turn.startedAt;
        console.warn(
          `[agent] empty turn — no assistant text and no tool calls (took ${elapsed}ms). ` +
            "Likely an upstream LLM/auth failure swallowed as success. " +
            "Check provider auth, model id, and pi-ai output handling.",
        );
        const reason =
          "The model returned no response. The upstream call may have failed silently — try re-authenticating.";
        broadcast("onAgentEvent", {
          type: "turn_error",
          kind: "auth",
          reason,
        } satisfies AppAgentEvent);
      }
      machine?.ingest({ type: "AGENT_END" });
      getNotifications().notifyAgentIdle(turn?.assistantText ?? undefined);
      turn = null;
      break;
    }
  }

  broadcast("onAgentEvent", event);
  void sendDispatchResponse(event);
}

async function startAgent(opts: { newSession?: boolean } = {}): Promise<void> {
  if (agent) return;
  const next = new Agent(opts);
  try {
    await next.start();
    next.subscribe((raw) => {
      const event = parseAgentEvent(raw);
      if (event) handleAgentEvent(event);
    });
    // Capture `next` in the closure rather than the module ref so the
    // scheduler's first tick can't observe a still-null `agent` during
    // the microtask between startScheduler and `agent = next`.
    getTaskManager().startScheduler(() => next);
  } catch (err) {
    // Don't leave a half-constructed Agent in the singleton — a retry's
    // `if (agent) return` would skip the rest of setup and the machine
    // would transition to ready with a non-functional agent.
    getTaskManager().stopScheduler();
    await next.stop().catch(() => {});
    throw err;
  }
  agent = next;
}

async function stopAgent(): Promise<void> {
  getTaskManager().stopScheduler();
  if (agent) {
    await agent.stop();
    agent = null;
  }
  // The executor daemon is started lazily by the executor extension at agent
  // start; tear it down here so it doesn't outlive the agent.
  await getExecutorDaemon().stop();
  turn = null;
}

async function newSession(): Promise<void> {
  await stopAgent();
  await startAgent({ newSession: true });
}

export function getAgent(): Agent | null {
  return agent;
}

/**
 * Re-run the provider OAuth flow and restart the session so the next turn
 * uses fresh credentials. Runs through the AppMachine's serialized queue so
 * a concurrent LOGIN/LOGOUT/SETUP can't race with the reauth's stopAgent +
 * startAgent. Used by the "Re-authenticate" Settings affordance and the
 * empty-turn modal.
 */
export async function reauthenticate(): Promise<{ ok: boolean; error?: string }> {
  if (!machine) return { ok: false, error: "Machine not initialized" };
  return machine.enqueueAsync(async () => {
    try {
      await login();
      await newSession();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[machine] reauthenticate failed:", message);
      return { ok: false, error: message };
    }
  });
}

// ---------------------------------------------------------------------------
// AppMachine class
// ---------------------------------------------------------------------------

export type Broadcast = (state: AppState) => void;

export class AppMachine {
  private state: AppState;
  private queue: Promise<void> = Promise.resolve();
  private destroying = false;

  constructor(
    private readonly deps: EffectDeps,
    private readonly broadcastState: Broadcast,
    initial: AppState = { phase: "logged_out" },
  ) {
    this.state = initial;
  }

  getState(): AppState {
    return this.state;
  }

  /** Awaitable — resolves after the triggered effect (if any) completes. */
  send(event: MachineEvent): Promise<void> {
    const p = this.queue.then(() => this.step(event));
    this.queue = p.catch(() => {});
    return p;
  }

  /** Non-awaitable enqueue — for callers that cannot await. */
  ingest(event: MachineEvent): void {
    void this.send(event);
  }

  /**
   * Run an async block through the same FIFO queue as send(). Lets external
   * lifecycle actions (e.g. reauthenticate) interleave safely with state
   * machine events instead of mutating the agent singleton in parallel.
   */
  enqueueAsync<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    // Swallow the value on the chain copy so a thrown reauth doesn't poison
    // subsequent events; the caller still sees the throw via the returned p.
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  async shutdown(): Promise<void> {
    this.destroying = true;
    await stopAgent();
  }

  private async step(event: MachineEvent): Promise<void> {
    if (this.destroying) return;

    const result = reduce(this.state, event);
    if (result === null) return;

    const prev = this.state;
    this.state = result.next;
    console.log(`[machine] ${prev.phase} -> ${this.state.phase}`);
    this.broadcastState(this.state);

    if (result.effect !== null) {
      const completion = await runEffect(result.effect, this.deps);
      if (this.destroying) return;
      await this.step(completion);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance — wired to real deps and Electron broadcast
// ---------------------------------------------------------------------------

let machine: AppMachine | null = null;

function broadcastAppState(state: AppState): void {
  broadcast("onAppState", state);
}

async function downloadVoiceModel(): Promise<void> {
  const result = await downloadModel();
  if (!result.ok) {
    throw new Error(result.error);
  }
}

const realDeps: EffectDeps = {
  login,
  seedResources,
  downloadVoiceModel,
  startAgent,
  stopAgent,
  teardownResources,
  newSession,
  reportSetupProgress: (progress) => broadcast("onSetupProgress", progress),
};

export function getAppState(): AppState {
  return machine?.getState() ?? { phase: "logged_out" };
}

export function transition(event: MachineEvent): void {
  machine?.ingest(event);
}

/** Determine initial state from persisted auth/setup and auto-start if ready. */
export function initMachine(): void {
  const loggedIn = isLoggedIn();
  const initial: AppState = loggedIn ? { phase: "logged_in" } : { phase: "logged_out" };
  machine = new AppMachine(realDeps, broadcastAppState, initial);

  if (loggedIn && isSetupComplete()) {
    void machine.send({ type: "SETUP" }).catch((err) => {
      console.error("[machine] init setup failed:", err);
    });
  } else {
    broadcastAppState(machine.getState());
  }
}


export async function shutdown(): Promise<void> {
  console.log("[machine] shutdown");
  await machine?.shutdown();
}
