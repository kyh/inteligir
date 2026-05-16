// ---------------------------------------------------------------------------
// Dispatch client — connects the desktop app to the relay API so the mobile
// app can send commands and receive agent events remotely.
//
// Uses PartySocket (WebSocket via PartyKit/Cloudflare Durable Objects) for
// real-time message relay and tRPC HTTP mutations for persistence.
//
// Lifecycle:
//   1. On startup, check for persisted credentials (~/.inteligir/dispatch.json)
//   2. If none, register a new device and show pairing code
//   3. Connect to PartySocket room for real-time messages
//   4. On connect, catch up any messages missed while offline
// ---------------------------------------------------------------------------

import PartySocket from "partysocket";
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
const PARTY_HOST = process.env["DISPATCH_PARTY_HOST"] ?? "localhost:1999";

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
let partySocket: PartySocket | null = null;
let onInboundMessage: ((msg: DispatchInboundMessage) => void) | null = null;
/** Track message IDs to deduplicate between WebSocket and catch-up */
const seenMessageIds = (() => {
  const MAX = 5000;
  const ids = new Set<string>();
  return {
    has: (id: string) => ids.has(id),
    add: (id: string) => {
      ids.add(id);
      if (ids.size > MAX) {
        const oldest = ids.values().next().value;
        if (oldest) ids.delete(oldest);
      }
    },
  };
})();

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
// API helpers (tRPC HTTP calls for persistence)
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
// PartySocket connection (replaces SSE/Supabase)
// ---------------------------------------------------------------------------

function connectPartySocket(deviceId: string): void {
  if (partySocket) {
    partySocket.close();
    partySocket = null;
  }

  partySocket = new PartySocket({
    host: PARTY_HOST,
    party: "dispatch-server",
    room: deviceId,
  });

  partySocket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.direction !== "to_device") return;

      const dedup = msg.id ?? msg.payload?.clientId;
      if (dedup && seenMessageIds.has(dedup)) return;
      if (dedup) seenMessageIds.add(dedup);

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
    } catch {
      // Skip malformed messages
    }
  });

  partySocket.addEventListener("open", () => {
    void catchUpPendingMessages();
  });
}

async function catchUpPendingMessages(): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) return;

  try {
    const result = await trpcMutation<{
      messages: DispatchInboundMessage[];
    }>("dispatch.catchUp", { deviceToken: creds.token });

    for (const msg of result.messages) {
      const clientId = (msg.payload as Record<string, unknown>)?.clientId;
      if (seenMessageIds.has(msg.id)) continue;
      if (typeof clientId === "string" && seenMessageIds.has(clientId)) continue;
      seenMessageIds.add(msg.id);
      if (typeof clientId === "string") seenMessageIds.add(clientId);

      if (msg.type === "device_paired") {
        if (!creds.paired) credentialStore.write({ ...creds, paired: true });
        setState({ status: "paired", pairingCode: null, pairingExpiresAt: null, error: null });
        continue;
      }

      if (dispatchState.status !== "paired") {
        if (!creds.paired) credentialStore.write({ ...creds, paired: true });
        setState({ status: "paired", pairingCode: null, pairingExpiresAt: null, error: null });
      }

      onInboundMessage?.(msg);
    }
  } catch {
    // Catch-up failures are non-fatal
  }
}

// ---------------------------------------------------------------------------
// Send agent event back to mobile (desktop → mobile)
// ---------------------------------------------------------------------------

export async function sendDispatchResponse(event: AppAgentEvent): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) return;
  if (dispatchState.status !== "paired") return;

  const payload = event as Record<string, unknown>;

  // Relay via WebSocket for instant delivery
  partySocket?.send(JSON.stringify({
    direction: "to_mobile",
    type: event.type,
    payload,
  }));

  // Only persist non-ephemeral events via HTTP
  const isEphemeral = event.type === "message_update" || event.type === "message_start";
  if (!isEphemeral) {
    try {
      await trpcMutation("dispatch.respond", {
        deviceToken: creds.token,
        type: event.type,
        payload,
      });
    } catch {
      // Persistence failures are non-fatal
    }
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
      connectPartySocket(creds.deviceId);
      if (!creds.paired) {
        void refreshPairingCode();
      }
    } else {
      void registerDevice().then(() => {
        const updatedCreds = credentialStore.read();
        if (updatedCreds) {
          connectPartySocket(updatedCreds.deviceId);
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
      connectPartySocket(newCreds.deviceId);
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
  if (partySocket) {
    partySocket.close();
    partySocket = null;
  }
  onInboundMessage = null;
}
