import PartySocket from "partysocket";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { broadcastToRenderer } from "@/main/lib/broadcast";
import {
  DispatchCredentialsSchema,
  DISPATCH_INITIAL_STATE,
  type DispatchCredentials,
  type DispatchInboundMessage,
  type DispatchState,
} from "@/shared/dispatch";
import { IPC_CHANNELS, toErrorMessage } from "@/shared/ipc";
import type { AppAgentEvent } from "@/shared/agent-events";


const API_BASE_URL = process.env["DISPATCH_API_URL"] ?? "http://localhost:3000";
const PARTY_HOST = process.env["DISPATCH_PARTY_HOST"] ?? "localhost:1999";


const credentialStore = new JsonStore<DispatchCredentials | null>(
  inteligirPath("dispatch.json"),
  DispatchCredentialsSchema.nullable(),
  null,
);


let dispatchState: DispatchState = { ...DISPATCH_INITIAL_STATE };
let partySocket: PartySocket | null = null;
let onInboundMessage: ((msg: DispatchInboundMessage) => void) | null = null;

const seenMessageIds = (() => {
  const MAX = 5000;
  const ids = new Set<string>();
  return {
    has: (id: string) => ids.has(id),
    add: (id: string) => {
      ids.add(id);
      if (ids.size > MAX) {
        const oldest = ids.keys().next().value;
        if (oldest) ids.delete(oldest);
      }
    },
  };
})();

function setState(patch: Partial<DispatchState>): void {
  const hasChange = (Object.keys(patch) as (keyof DispatchState)[]).some(
    (k) => dispatchState[k] !== patch[k],
  );
  if (!hasChange) return;
  dispatchState = { ...dispatchState, ...patch };
  broadcastToRenderer(IPC_CHANNELS.DISPATCH_STATE, dispatchState);
}

export function getDispatchState(): DispatchState {
  return dispatchState;
}


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


function transitionToPaired(): void {
  if (dispatchState.status === "paired") return;
  const creds = credentialStore.read();
  if (creds && !creds.paired) credentialStore.write({ ...creds, paired: true });
  setState({ status: "paired", pairingCode: null, pairingExpiresAt: null, error: null });
}

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
        transitionToPaired();
        return;
      }

      transitionToPaired();
      onInboundMessage?.({
        id: msg.id ?? msg.payload?.clientId ?? "",
        type: msg.type,
        payload: msg.payload,
        createdAt: msg.createdAt ?? new Date().toISOString(),
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

      transitionToPaired();
      if (msg.type === "device_paired") continue;
      onInboundMessage?.(msg);
    }
  } catch {
    // Catch-up failures are non-fatal
  }
}


export async function sendDispatchResponse(event: AppAgentEvent): Promise<void> {
  const creds = credentialStore.read();
  if (!creds) return;
  if (dispatchState.status !== "paired") return;

  const payload = event as Record<string, unknown>;

  partySocket?.send(JSON.stringify({
    direction: "to_mobile",
    type: event.type,
    payload,
  }));

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

export function shutdownDispatch(): void {
  if (partySocket) {
    partySocket.close();
    partySocket = null;
  }
  onInboundMessage = null;
}
