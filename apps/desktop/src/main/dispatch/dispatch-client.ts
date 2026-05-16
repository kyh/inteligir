// ---------------------------------------------------------------------------
// Dispatch client — connects the desktop app to the relay API so the mobile
// app can send commands and receive agent events remotely.
//
// Uses tRPC SSE subscriptions (Server-Sent Events) for real-time delivery.
//
// Lifecycle:
//   1. On startup, check for persisted credentials (~/.inteligir/dispatch.json)
//   2. If none, register a new device and show pairing code
//   3. Subscribe to SSE stream for inbound messages
//   4. On connect, pending messages are delivered via the subscription
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
import { IPC_CHANNELS, toErrorMessage } from "@/shared/ipc";
import type { AppAgentEvent } from "@/shared/agent-events";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env["DISPATCH_API_URL"] ?? "http://localhost:3000";
const SSE_RECONNECT_DELAY_MS = 3000;

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
let sseAbortController: AbortController | null = null;
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
// API helpers (tRPC HTTP calls)
// ---------------------------------------------------------------------------

type TRPCResult<T> = { result: { data: { json: T } } };

async function trpcMutation<T>(procedure: string, input: unknown): Promise<T> {
  const url = `${API_BASE_URL}/api/trpc/${procedure}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dispatch API error (${res.status}): ${text}`);
  }
  const json = (await res.json()) as TRPCResult<T>;
  return json.result.data.json;
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
      paired: false,
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
      error: toErrorMessage(err),
    });
  }
}

// ---------------------------------------------------------------------------
// SSE subscription (replaces Supabase Realtime)
// ---------------------------------------------------------------------------

function subscribeToSSE(deviceToken: string): void {
  // Tear down existing connection
  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }

  const controller = new AbortController();
  sseAbortController = controller;

  void connectSSE(deviceToken, controller);
}

async function connectSSE(
  deviceToken: string,
  controller: AbortController,
): Promise<void> {
  // Build tRPC SSE subscription URL
  const input = encodeURIComponent(JSON.stringify({ json: { deviceToken } }));
  const url = `${API_BASE_URL}/api/trpc/dispatch.subscribeDevice?input=${input}`;

  while (!controller.signal.aborted) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`SSE connection failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep incomplete last line in buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const envelope = JSON.parse(line.slice(6));
            handleSSEEvent(envelope);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("[dispatch] SSE error, reconnecting:", err);
    }

    if (controller.signal.aborted) return;
    await new Promise((r) => setTimeout(r, SSE_RECONNECT_DELAY_MS));
  }
}

function handleSSEEvent(envelope: unknown): void {
  // tRPC tracked envelopes: [id, data] or { result: { data: ... } }
  const msg = extractMessage(envelope);
  if (!msg) return;

  if (msg.type === "device_paired") {
    const creds = credentialStore.read();
    if (creds) credentialStore.write({ ...creds, paired: true });
    setState({
      status: "paired",
      pairingCode: null,
      pairingExpiresAt: null,
      error: null,
    });
    return;
  }

  // Transition to paired on first inbound message if not already
  if (dispatchState.status !== "paired") {
    const creds = credentialStore.read();
    if (creds) credentialStore.write({ ...creds, paired: true });
    setState({ status: "paired", pairingCode: null, pairingExpiresAt: null, error: null });
  }

  onInboundMessage?.({
    id: msg.id,
    type: msg.type,
    payload: msg.payload,
    createdAt: msg.createdAt,
  });
}

type SSEMessage = {
  id: string;
  type: DispatchInboundMessage["type"] | "device_paired";
  payload: Record<string, unknown>;
  createdAt: string;
};

function extractMessage(envelope: unknown): SSEMessage | null {
  if (!envelope || typeof envelope !== "object") return null;

  // tRPC SSE format: { result: { type: "data", data: { json: [id, data] } } }
  const outer = envelope as Record<string, unknown>;
  const result = outer["result"] as Record<string, unknown> | undefined;

  if (result?.["type"] === "data") {
    const dataWrapper = result["data"] as Record<string, unknown> | undefined;
    const json = dataWrapper?.["json"];

    // tracked() wraps as [id, data]
    if (Array.isArray(json) && json.length === 2) {
      return json[1] as SSEMessage;
    }
    if (json && typeof json === "object") {
      return json as SSEMessage;
    }
  }

  return null;
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
 */
export function initDispatch(
  handler: (msg: DispatchInboundMessage) => void,
): void {
  onInboundMessage = handler;

  try {
    const creds = credentialStore.read();
    if (creds) {
      setState({
        status: creds.paired ? "paired" : "awaiting_pairing",
        deviceId: creds.deviceId,
        pairingCode: null,
        pairingExpiresAt: null,
        error: null,
      });
      subscribeToSSE(creds.token);
      if (!creds.paired) {
        void refreshPairingCode();
      }
    } else {
      void registerDevice().then(() => {
        const updatedCreds = credentialStore.read();
        if (updatedCreds) {
          subscribeToSSE(updatedCreds.token);
        }
      });
    }
  } catch (err) {
    console.error("[dispatch] init failed (non-fatal):", err);
    setState({ status: "error", error: toErrorMessage(err) });
  }
}

/**
 * Request a new pairing code (e.g., if the previous one expired).
 */
export async function refreshPairingCode(): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) {
    await registerDevice();
    const newCreds = credentialStore.read();
    if (newCreds) {
      subscribeToSSE(newCreds.token);
    }
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
      error: toErrorMessage(err),
    });
  }
}

/**
 * Shut down the dispatch system. Call on app quit.
 */
export function shutdownDispatch(): void {
  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }
  onInboundMessage = null;
}
