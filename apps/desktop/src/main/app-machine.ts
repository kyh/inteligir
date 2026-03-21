import { BrowserWindow } from "electron";

import {
  Agent,
  isLoggedIn,
  isSetupComplete,
  login,
  seedResources,
  teardownResources,
} from "@/main/agent/agent";
import { disposeBrowserTool } from "@/main/agent/browser-tool";
import { TaskScheduler } from "@/main/tasks/task-scheduler";
import { IPC_CHANNELS, toErrorMessage } from "@/shared/ipc";
import type { AppEvent, AppState } from "@/shared/app-state";

type AgentEventListener = (event: unknown) => void;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Listener = (state: AppState) => void;

let state: AppState = { phase: "logged_out" };
let agent: Agent | null = null;
let scheduler: TaskScheduler | null = null;
let agentUnsub: (() => void) | null = null;
const listeners = new Set<Listener>();
const agentEventListeners = new Set<AgentEventListener>();

function setState(next: AppState): void {
  const prev = state;
  state = next;
  console.log(`[machine] ${prev.phase} -> ${next.phase}`);
  broadcast();
  for (const fn of listeners) {
    try { fn(next); } catch { /* */ }
  }
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.APP_STATE, state);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getAppState(): AppState {
  return state;
}

export function getAgent(): Agent | null {
  return agent;
}

export function onStateChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Subscribe to raw agent session events (for chat streaming). */
export function onAgentEvent(fn: AgentEventListener): () => void {
  agentEventListeners.add(fn);
  return () => { agentEventListeners.delete(fn); };
}

/** Determine initial state from persisted auth/setup and auto-start if ready. */
export function initMachine(): void {
  if (isLoggedIn() && isSetupComplete()) {
    setState({ phase: "setting_up" });
    void doStartAgent()
      .then(() => setState({ phase: "ready", agent: "idle" }))
      .catch((err) => setState({ phase: "error", prev: "setting_up", message: toErrorMessage(err) }));
  } else if (isLoggedIn()) {
    setState({ phase: "logged_in" });
  } else {
    setState({ phase: "logged_out" });
  }
}

export function transition(event: AppEvent): void {
  console.log(`[machine] event: ${event.type} (current: ${state.phase})`);

  switch (event.type) {
    case "LOGIN":
      if (state.phase !== "logged_out") return;
      setState({ phase: "logging_in" });
      void doLogin();
      return;

    case "SETUP":
      if (state.phase !== "logged_in") return;
      setState({ phase: "setting_up" });
      void doSetup();
      return;

    case "LOGOUT":
      if (state.phase !== "ready" && state.phase !== "error") return;
      setState({ phase: "logging_out" });
      void doLogout();
      return;

    case "RETRY": {
      if (state.phase !== "error") return;
      const prev = state.prev;
      if (prev === "logging_in") {
        setState({ phase: "logging_in" });
        void doLogin();
      } else if (prev === "setting_up") {
        setState({ phase: "setting_up" });
        void doSetup();
      } else if (prev === "ready") {
        setState({ phase: "setting_up" });
        void doStartAgent()
          .then(() => setState({ phase: "ready", agent: "idle" }))
          .catch((err) => setState({ phase: "error", prev: "ready", message: toErrorMessage(err) }));
      }
      return;
    }
  }
}

/** Graceful shutdown — wait for agent to finish, then stop. */
export async function shutdown(): Promise<void> {
  console.log("[machine] shutdown");
  scheduler?.stop();
  scheduler = null;

  if (agent) {
    const idle = await agent.waitForIdle(5_000);
    if (!idle) {
      console.warn("[machine] agent did not reach idle within timeout, force-stopping");
    }
    agentUnsub?.();
    agentUnsub = null;
    await agent.stop();
    agent = null;
  }

  await disposeBrowserTool();
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

async function doLogin(): Promise<void> {
  try {
    await login();
    setState({ phase: "logged_in" });
  } catch (err) {
    setState({ phase: "error", prev: "logging_in", message: toErrorMessage(err) });
  }
}

async function doSetup(): Promise<void> {
  try {
    seedResources();
    await doStartAgent();
    setState({ phase: "ready", agent: "idle" });
  } catch (err) {
    setState({ phase: "error", prev: "setting_up", message: toErrorMessage(err) });
  }
}

async function doStartAgent(): Promise<void> {
  agent = new Agent();
  await agent.start();

  agentUnsub = agent.subscribe((event) => {
    // Forward raw events to chat streaming listeners
    for (const fn of agentEventListeners) {
      try { fn(event); } catch { /* */ }
    }

    // Update machine state for lifecycle transitions
    if (state.phase !== "ready") return;
    if (event.type === "agent_start") {
      setState({ phase: "ready", agent: "busy" });
    } else if (event.type === "agent_end") {
      setState({ phase: "ready", agent: "idle" });
    }
  });

  scheduler = new TaskScheduler(() => agent);
  scheduler.start();
}

async function doLogout(): Promise<void> {
  scheduler?.stop();
  scheduler = null;

  if (agent) {
    agentUnsub?.();
    agentUnsub = null;
    await agent.stop();
    agent = null;
  }

  teardownResources();
  setState({ phase: "logged_out" });
}
