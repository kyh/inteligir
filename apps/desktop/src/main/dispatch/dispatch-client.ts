// ---------------------------------------------------------------------------
// Dispatch client — connects the desktop app to the relay API so the mobile
// app can send commands and receive agent events remotely.
//
// Lifecycle:
//   1. On startup, check for persisted credentials (~/.inteligir/dispatch.json)
//   2. If none, register a new device and show pairing code
//   3. Poll the relay for inbound messages on an interval
//   4. Forward inbound messages to the agent via the existing command system
//   5. Forward agent events back to the relay as responses
// ---------------------------------------------------------------------------

import { BrowserWindow } from "electron";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import {
  DispatchCredentialsSchema,
  DISPATCH_INITIAL_STATE,
  type DispatchCredentials,
  type DispatchInboundMessage,
  type DispatchState,
} from "@/shared/dispatch";
import { IPC_CHANNELS } from "@/shared/ipc";
import type { AppAgentEvent } from "@/shared/agent-events";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env["DISPATCH_API_URL"] ?? "http://localhost:3000";
const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Persistent credential store
// ---------------------------------------------------------------------------

const credentialStore = new JsonStore<DispatchCredentials | null>(
  inteligirPath("dispatch.json"),
  DispatchCredentialsSchema.nullable(),
  null,
);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let dispatchState: DispatchState = { ...DISPATCH_INITIAL_STATE };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let onInboundMessage: ((msg: DispatchInboundMessage) => void) | null = null;

function setState(patch: Partial<DispatchState>): void {
  dispatchState = { ...dispatchState, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.DISPATCH_STATE, dispatchState);
    }
  }
}

export function getDispatchState(): DispatchState {
  return dispatchState;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

type TRPCResult<T> = { result: { data: T } };

async function trpcMutation<T>(procedure: string, input: unknown): Promise<T> {
  const url = `${API_BASE_URL}/api/trpc/${procedure}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dispatch API error (${res.status}): ${text}`);
  }
  const json = (await res.json()) as TRPCResult<T>;
  return json.result.data;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function registerDevice(): Promise<void> {
  setState({ status: "registering", error: null });

  try {
    const os = await import("node:os");
    const result = await trpcMutation<{
      deviceId: string;
      token: string;
      pairingCode: string;
      expiresAt: string;
    }>("dispatch.registerDevice", { name: os.hostname() });

    credentialStore.write({
      deviceId: result.deviceId,
      token: result.token,
    });

    setState({
      status: "awaiting_pairing",
      deviceId: result.deviceId,
      pairingCode: result.pairingCode,
      pairingExpiresAt: result.expiresAt,
    });
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

async function sendHeartbeat(): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) return;

  try {
    await trpcMutation("dispatch.heartbeat", { deviceToken: creds.token });
  } catch {
    // Heartbeat failures are non-fatal; next one will retry
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function pollOnce(): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) return;

  try {
    const result = await trpcMutation<{
      messages: DispatchInboundMessage[];
    }>("dispatch.pollMessages", { deviceToken: creds.token });

    for (const msg of result.messages) {
      onInboundMessage?.(msg);
    }
  } catch (err) {
    // If token is invalid, clear credentials and re-register
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNAUTHORIZED")) {
      credentialStore.write(null);
      setState({ ...DISPATCH_INITIAL_STATE, status: "error", error: "Device token rejected" });
      stopPolling();
    }
  }
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  // Immediate first poll + heartbeat
  void pollOnce();
  void sendHeartbeat();
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Send agent event back to mobile (desktop → mobile)
// ---------------------------------------------------------------------------

export async function sendDispatchResponse(event: AppAgentEvent): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) return;
  if (dispatchState.status !== "paired") return;

  try {
    await trpcMutation("dispatch.respond", {
      deviceToken: creds.token,
      type: event.type,
      payload: event as Record<string, unknown>,
    });
  } catch {
    // Response failures are non-fatal
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the dispatch system. Call once from main process startup.
 *
 * @param handler - Called when a mobile user sends a command to this device
 */
export function initDispatch(
  handler: (msg: DispatchInboundMessage) => void,
): void {
  onInboundMessage = handler;

  const creds = credentialStore.read();
  if (creds) {
    // Already registered — assume paired and start polling
    setState({
      status: "paired",
      deviceId: creds.deviceId,
      pairingCode: null,
      pairingExpiresAt: null,
      error: null,
    });
    startPolling();
  } else {
    // First time — register and show pairing code
    void registerDevice().then(() => {
      startPolling();
    });
  }
}

/**
 * Request a new pairing code (e.g., if the previous one expired).
 */
export async function refreshPairingCode(): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) {
    await registerDevice();
    return;
  }

  try {
    const result = await trpcMutation<{
      pairingCode: string;
      expiresAt: string;
    }>("dispatch.refreshPairingCode", { deviceToken: creds.token });

    setState({
      status: "awaiting_pairing",
      pairingCode: result.pairingCode,
      pairingExpiresAt: result.expiresAt,
    });
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Shut down the dispatch system. Call on app quit.
 */
export function shutdownDispatch(): void {
  stopPolling();
  onInboundMessage = null;
}
