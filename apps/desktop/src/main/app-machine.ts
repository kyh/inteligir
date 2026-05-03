// ---------------------------------------------------------------------------
// App state machine — serialized async queue, injectable deps + broadcast.
// ---------------------------------------------------------------------------

import {
  Agent,
  installGws,
  isLoggedIn,
  isSetupComplete,
  login,
  seedResources,
  teardownResources,
} from "@/agent/setup";
import { getPersistedActiveTools } from "@/main/active-tools";
import { reduce } from "@/main/app-reducer";
import { runEffect, type EffectDeps } from "@/main/app-effects";
import { broadcastToRenderer } from "@/main/lib/broadcast";
import { getNotifications } from "@/main/notifications";
import { clearResolvedSessionFile } from "@/main/session-history";
import { taskManager } from "@/main/tasks/task-singleton";
import { parseAgentEvent } from "@/shared/agent-event-parser";
import type { AppAgentEvent } from "@/shared/agent-events";
import { IPC_CHANNELS } from "@/shared/ipc";
import type { AppState, MachineEvent } from "@/shared/app-state";

// ---------------------------------------------------------------------------
// Agent singleton — runs in the main process
// ---------------------------------------------------------------------------

let agent: Agent | null = null;

// Track this turn's assistant text directly; getLastAssistantText() on the
// session would return the *previous* turn's text after an early abort.
let currentTurnAssistantText: string | null = null;

function handleAgentEvent(event: AppAgentEvent): void {
  if (event.type === "message_end" && event.stopReason === "error") {
    console.error("[agent] error event:", event);
  }

  switch (event.type) {
    case "agent_start":
      currentTurnAssistantText = null;
      machine?.ingest({ type: "AGENT_START" });
      break;
    case "message_end":
      if (event.role === "assistant" && event.text) {
        currentTurnAssistantText = event.text;
      }
      break;
    case "agent_end":
      machine?.ingest({ type: "AGENT_END" });
      getNotifications().notifyAgentIdle(currentTurnAssistantText ?? undefined);
      currentTurnAssistantText = null;
      break;
  }

  broadcastToRenderer(IPC_CHANNELS.AGENT_EVENT, event);
}

async function startAgent(opts: { newSession?: boolean } = {}): Promise<void> {
  if (agent) return;
  const next = new Agent(opts);
  try {
    await next.start();
    const persisted = getPersistedActiveTools();
    if (persisted) next.setActiveTools(persisted);
    next.subscribe((raw) => {
      const event = parseAgentEvent(raw);
      if (event) handleAgentEvent(event);
    });
    // Capture `next` in the closure rather than the module ref so the
    // scheduler's first tick can't observe a still-null `agent` during
    // the microtask between startScheduler and `agent = next`.
    taskManager.startScheduler(() => next);
  } catch (err) {
    // Don't leave a half-constructed Agent in the singleton — a retry's
    // `if (agent) return` would skip the rest of setup and the machine
    // would transition to ready with a non-functional agent.
    taskManager.stopScheduler();
    await next.stop().catch(() => {});
    throw err;
  }
  agent = next;
}

async function stopAgent(): Promise<void> {
  taskManager.stopScheduler();
  if (agent) {
    await agent.stop();
    agent = null;
  }
  currentTurnAssistantText = null;
}

async function newSession(): Promise<void> {
  clearResolvedSessionFile();
  await stopAgent();
  await startAgent({ newSession: true });
}

export function getAgent(): Agent | null {
  return agent;
}

// ---------------------------------------------------------------------------
// AppMachine class
// ---------------------------------------------------------------------------

export type Broadcast = (state: AppState) => void;

export class AppMachine {
  private _state: AppState;
  private _queue: Promise<void> = Promise.resolve();
  private _destroying = false;

  constructor(
    private readonly _deps: EffectDeps,
    private readonly _broadcast: Broadcast,
    initial: AppState = { phase: "logged_out" },
  ) {
    this._state = initial;
  }

  getState(): AppState {
    return this._state;
  }

  /** Awaitable — resolves after the triggered effect (if any) completes. */
  send(event: MachineEvent): Promise<void> {
    const p = this._queue.then(() => this._step(event));
    this._queue = p.catch(() => {});
    return p;
  }

  /** Non-awaitable enqueue — for callers that cannot await. */
  ingest(event: MachineEvent): void {
    void this.send(event);
  }

  async shutdown(): Promise<void> {
    this._destroying = true;
    await stopAgent();
  }

  private async _step(event: MachineEvent): Promise<void> {
    if (this._destroying) return;

    const result = reduce(this._state, event);
    if (result === null) return;

    const prev = this._state;
    this._state = result.next;
    console.log(`[machine] ${prev.phase} -> ${this._state.phase}`);
    this._broadcast(this._state);

    if (result.effect !== null) {
      const completion = await runEffect(result.effect, this._deps);
      if (this._destroying) return;
      await this._step(completion);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance — wired to real deps and Electron broadcast
// ---------------------------------------------------------------------------

let machine: AppMachine | null = null;

function broadcast(state: AppState): void {
  broadcastToRenderer(IPC_CHANNELS.APP_STATE, state);
}

const realDeps: EffectDeps = {
  login,
  seedResources,
  installGws,
  startAgent,
  stopAgent,
  teardownResources,
  newSession,
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
  machine = new AppMachine(realDeps, broadcast, initial);

  if (loggedIn && isSetupComplete()) {
    void machine.send({ type: "SETUP" }).catch((err) => {
      console.error("[machine] init setup failed:", err);
    });
  } else {
    broadcast(machine.getState());
  }
}

export async function shutdown(): Promise<void> {
  console.log("[machine] shutdown");
  await machine?.shutdown();
}
