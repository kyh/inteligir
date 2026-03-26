// ---------------------------------------------------------------------------
// App state machine — serialized async queue, injectable deps + broadcast.
// ---------------------------------------------------------------------------

import {
  isLoggedIn,
  isSetupComplete,
  login,
  seedResources,
  teardownResources,
} from "@/agent/setup";
import { disposeBrowserTool } from "@/agent/browser-tool";
import { killSidecar } from "@/main/voice/livekit-ipc";
import { reduce } from "@/main/app-reducer";
import { runEffect, type EffectDeps } from "@/main/app-effects";
import type { AppAgentEvent } from "@/shared/agent-events";
import { IPC_CHANNELS } from "@/shared/ipc";
import type { AppState, MachineEvent } from "@/shared/app-state";

import { BrowserWindow } from "electron";

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
    // Absorb errors so a failed effect doesn't freeze the queue
    this._queue = p.catch(() => {});
    return p;
  }

  /** Non-awaitable enqueue — for callers that cannot await (sidecar events). */
  ingest(event: MachineEvent): void {
    void this.send(event);
  }

  async shutdown(): Promise<void> {
    this._destroying = true;
    this._deps.disposeBrowserTool();
    await this._deps.killSidecar();
  }

  // ---- Internal -------------------------------------------------------------

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
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.APP_STATE, state);
    }
  }
}

const realDeps: EffectDeps = {
  login,
  seedResources,
  teardownResources,
  disposeBrowserTool,
  killSidecar,
};

export function getAppState(): AppState {
  return machine?.getState() ?? { phase: "logged_out" };
}

export function transition(event: MachineEvent): void {
  machine?.ingest(event);
}

/**
 * Called by livekit-ipc when the sidecar forwards an agent event.
 * Maps relevant events to machine events.
 */
export function handleSidecarAgentEvent(event: AppAgentEvent): void {
  // Log agent errors so they appear in Electron main process logs
  if (event.type === "message_end" && event.stopReason === "error") {
    console.error("[agent] error event:", event);
  }

  switch (event.type) {
    case "agent_start":
      machine?.ingest({ type: "AGENT_START" });
      break;
    case "agent_end":
      machine?.ingest({ type: "AGENT_END" });
      break;
  }
}

/** Determine initial state from persisted auth/setup and auto-start if ready. */
export function initMachine(): void {
  if (isLoggedIn() && isSetupComplete()) {
    // Start in logged_in so SETUP event is valid, triggering seedResources → ready
    machine = new AppMachine(realDeps, broadcast, { phase: "logged_in" });
    void machine.send({ type: "SETUP" }).catch((err) => {
      console.error("[machine] init setup failed:", err);
    });
  } else if (isLoggedIn()) {
    machine = new AppMachine(realDeps, broadcast, { phase: "logged_in" });
    broadcast(machine.getState());
  } else {
    machine = new AppMachine(realDeps, broadcast);
    broadcast(machine.getState());
  }
}

export async function shutdown(): Promise<void> {
  console.log("[machine] shutdown");
  await machine?.shutdown();
}
