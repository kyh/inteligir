import { BrowserWindow } from "electron";

import {
  isLoggedIn,
  isSetupComplete,
  login,
  seedResources,
  teardownResources,
} from "@/agent/setup";
import { ToolManager } from "@/main/tool-manager";
import { killSidecar } from "@/main/voice/livekit-ipc";
import { IPC_CHANNELS, isRecord, toErrorMessage } from "@/shared/ipc";
import type { AppEvent, AppState } from "@/shared/app-state";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

let state: AppState = { phase: "logged_out" };
const toolManager = new ToolManager();

function setState(next: AppState): void {
  const prev = state;
  state = next;
  console.log(`[machine] ${prev.phase} -> ${next.phase}`);
  broadcast();
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

/**
 * Called by livekit-ipc when the sidecar forwards an agent event.
 * Updates busy/idle machine state.
 */
export function handleSidecarAgentEvent(event: unknown): void {
  if (!isRecord(event)) return;

  // Log agent errors so they appear in Electron main process logs
  if (event.type === "message_end" && event.stopReason === "error") {
    console.error("[agent] error event:", event);
  }

  if (state.phase !== "ready") return;
  if (event.type === "agent_start") {
    setState({ phase: "ready", agent: "busy" });
  } else if (event.type === "agent_end") {
    setState({ phase: "ready", agent: "idle" });
  }
}

/** Determine initial state from persisted auth/setup and auto-start if ready. */
export function initMachine(): void {
  if (isLoggedIn() && isSetupComplete()) {
    setState({ phase: "setting_up" });
    void doSetupReady()
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
        void doSetupReady()
          .then(() => setState({ phase: "ready", agent: "idle" }))
          .catch((err) => setState({ phase: "error", prev: "ready", message: toErrorMessage(err) }));
      }
      return;
    }
  }
}

/** Graceful shutdown — kill sidecar agent worker. */
export async function shutdown(): Promise<void> {
  console.log("[machine] shutdown");
  killSidecar();
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
    await doSetupReady();
    setState({ phase: "ready", agent: "idle" });
  } catch (err) {
    setState({ phase: "error", prev: "setting_up", message: toErrorMessage(err) });
  }
}

/** Seed resources and ensure tools — agent lives in sidecar. */
async function doSetupReady(): Promise<void> {
  seedResources();
  void toolManager.ensureAll().catch((err) => {
    console.error("[machine] tool install failed:", err);
  });
}

async function doLogout(): Promise<void> {
  teardownResources();
  setState({ phase: "logged_out" });
}
