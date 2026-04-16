// ---------------------------------------------------------------------------
// Dispatch client — connects the desktop app to the relay API so the mobile
// app can send commands and receive agent events remotely.
//
// Uses Supabase Realtime (Broadcast channels + Presence) instead of polling.
//
// Lifecycle:
//   1. On startup, check for persisted credentials (~/.inteligir/dispatch.json)
//   2. If none, register a new device and show pairing code
//   3. Subscribe to Supabase Broadcast channel for inbound messages
//   4. Track presence so mobile can see device is online
//   5. On connect, catch up any messages missed while offline
// ---------------------------------------------------------------------------

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
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
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

// ---------------------------------------------------------------------------
// Supabase client (for Realtime only)
// ---------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
let channel: RealtimeChannel | null = null;
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
// Supabase Realtime subscription
// ---------------------------------------------------------------------------

function subscribeToChannel(deviceId: string): void {
  // Clean up existing channel
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }

  channel = supabase.channel(`dispatch:${deviceId}`);

  // Listen for broadcast messages
  channel.on("broadcast", { event: "dispatch_message" }, ({ payload }) => {
    if (payload.direction === "to_device") {
      onInboundMessage?.({
        id: payload.id,
        type: payload.type,
        payload: payload.payload,
        createdAt: payload.createdAt,
      });
    }
  });

  // Listen for pairing completion
  channel.on("broadcast", { event: "device_paired" }, () => {
    setState({
      status: "paired",
      pairingCode: null,
      pairingExpiresAt: null,
      error: null,
    });
  });

  // Track presence so mobile can see we're online
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel!.track({
        deviceId,
        online_at: new Date().toISOString(),
      });

      // Catch up on any messages missed while offline
      void catchUpPendingMessages();
    }
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

  const creds = credentialStore.read();
  if (creds) {
    setState({
      status: "paired",
      deviceId: creds.deviceId,
      pairingCode: null,
      pairingExpiresAt: null,
      error: null,
    });
    subscribeToChannel(creds.deviceId);
  } else {
    void registerDevice().then(() => {
      const updatedCreds = credentialStore.read();
      if (updatedCreds) {
        subscribeToChannel(updatedCreds.deviceId);
      }
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
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  onInboundMessage = null;
}
