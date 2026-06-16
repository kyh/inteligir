// ---------------------------------------------------------------------------
// Dispatch client — the desktop's connection to the relay Worker.
//
// Remote Access is OPT-IN and OFF by default: until the user enables it, no
// socket is opened and no room file exists. Enabling mints a pairing
// credential (CSPRNG roomId + bearer token, @repo/dispatch/pairing), persists
// it in ~/.inteligir/dispatch-room.json, and connects with
// `role=desktop&token=…` — the Worker stores SHA-256(token) on this first
// connect (the "claim") and refuses any later connection whose token doesn't
// hash-match.
//
// Trust boundaries:
//  - Every inbound frame is parsed with `parseMessage` (typed discriminated
//    union, never a cast). Invalid frames are dropped and logged.
//  - Agent transcript events are forwarded ONLY while an authenticated
//    mobile peer is present in the room (tracked via the server's
//    presence/peer_joined/peer_left messages). No peer, no bytes on the wire.
//  - Rotate/disable send `room_teardown` so the Worker wipes the stored
//    token hash — the old credential dies with the old room.
//
// Auth note: there is no desktop-side shared secret anymore. The pairing
// token authenticates this socket at connect time; the external chat
// gateway authenticates to the relay DO server-side (x-relay-secret header).
// The legacy DISPATCH_CHAT_SECRET / chat_device_register flow is gone.
//
// The module is a thin singleton over `createDispatchClient`, which takes
// injectable deps (store / socket factory / state sink) so tests exercise
// the full lifecycle without Electron or a network.
// ---------------------------------------------------------------------------

import { app } from "electron";
import PartySocket from "partysocket";
import { Type, type Static } from "@sinclair/typebox";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  utf8ByteLength,
  type AgentEvent,
  type ChatMessage,
  type DispatchMessage,
  type ErrorMessage,
  type InterruptMessage,
  type SteerMessage,
  type UserMessage,
} from "@repo/dispatch/protocol";
import {
  formatPairingString,
  generatePairingCredential,
  type PairingCredential,
} from "@repo/dispatch/pairing";
import {
  buildConnectionConfig,
  DEFAULT_SERVER_HOST,
  PRODUCTION_SERVER_HOST,
  type ConnectionConfig,
} from "@repo/dispatch/room";
import { createConnectionAttemptRegistry } from "@repo/dispatch/connection";
import { broadcast } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import type { DispatchState } from "@/shared/dispatch";
import type { AppAgentEvent } from "@/shared/agent-events";

// ---------------------------------------------------------------------------
// Persisted store — ~/.inteligir/dispatch-room.json
// ---------------------------------------------------------------------------

const PairingCredentialSchema = Type.Object({
  roomId: Type.String(),
  token: Type.String(),
});

export const DispatchStoreSchema = Type.Object({
  version: Type.Literal(1),
  /** The Remote Access opt-in. False ⇒ never connect. */
  enabled: Type.Boolean(),
  /** Current pairing credential; null until first enable / after disable. */
  credential: Type.Union([PairingCredentialSchema, Type.Null()]),
});
export type DispatchStore = Static<typeof DispatchStoreSchema>;

export const DISPATCH_STORE_DEFAULT: DispatchStore = {
  version: 1,
  enabled: false,
  credential: null,
};

export const DISPATCH_STORE_VERSIONING = {
  current: 1,
  // The unversioned era stored a bare 6-char Math.random room code (or null)
  // for a token-less protocol that no longer exists. There is nothing usable
  // to carry forward — and the new posture is opt-in — so legacy files map
  // to the disabled default rather than silently re-enabling Remote Access.
  fromLegacy: (): DispatchStore => ({ ...DISPATCH_STORE_DEFAULT }),
} as const;

// ---------------------------------------------------------------------------
// Injectable deps
// ---------------------------------------------------------------------------

/** Minimal structural surface of PartySocket the client uses. */
export type DispatchSocket = {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  send(data: string): void;
  close(): void;
  readyState: number;
};

export type DispatchClientDeps = {
  store: JsonStore<DispatchStore>;
  /** Relay host, resolved per-connect (env override / packaged vs dev). */
  host: () => string;
  createSocket: (config: ConnectionConfig) => DispatchSocket;
  onStateChange: (state: DispatchState) => void;
};

/** The inbound message types the desktop acts on. Everything else from the
 * wire is presence/error bookkeeping handled inside the client. */
export type DispatchInbound = UserMessage | SteerMessage | InterruptMessage | ChatMessage;
export type DispatchInboundHandler = (message: DispatchInbound) => void;

const SOCKET_OPEN = 1; // WebSocket.OPEN — literal to stay runtime-agnostic.

/** WebSocket policy-violation close. The relay closes with this code (reason
 * "unauthorized" / "invalid_room") when it refuses the credential — see
 * apps/server/src/server.ts onConnect. Retrying is pointless: the token will
 * never start hash-matching again. */
const CLOSE_POLICY_VIOLATION = 1008;

/** True when a serialized frame exceeds the protocol's per-frame byte cap.
 * Cheap fast-path: ≤3 UTF-8 bytes per UTF-16 code unit, so short strings
 * can't exceed the cap and skip the exact count. */
function frameTooLarge(raw: string): boolean {
  if (raw.length * 3 <= MAX_MESSAGE_BYTES) return false;
  return utf8ByteLength(raw) > MAX_MESSAGE_BYTES;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type DispatchClient = {
  init(handler: DispatchInboundHandler): void;
  getState(): DispatchState;
  setEnabled(enabled: boolean): DispatchState;
  rotateCredential(): DispatchState;
  sendAgentEvent(event: AgentEvent): void;
  sendChatReply(correlationId: string, text: string): void;
  shutdown(): void;
};

export function createDispatchClient(deps: DispatchClientDeps): DispatchClient {
  const attempts = createConnectionAttemptRegistry();

  let handler: DispatchInboundHandler | null = null;
  let socket: DispatchSocket | null = null;
  let credential: PairingCredential | null = null;
  /** roomId of the live connection attempt — NOT derived from `credential`
   * (rotate replaces the credential before the old socket is torn down, and
   * cancelling the wrong key would let a stale socket's late close event
   * clobber the new connection's state). */
  let activeRoomId: string | null = null;
  let enabled = false;
  let socketOpen = false;
  let mobilePresent = false;
  let fatalError: string | null = null;

  let lastEmitted: string | null = null;

  function currentState(): DispatchState {
    if (!enabled || !credential) return { status: "off" };
    const pairing = formatPairingString(credential);
    if (fatalError !== null) return { status: "error", pairing, message: fatalError };
    if (socketOpen) return { status: "connected", pairing, mobilePresent };
    return { status: "connecting", pairing };
  }

  function emitState(): DispatchState {
    const state = currentState();
    const serialized = JSON.stringify(state);
    if (serialized !== lastEmitted) {
      lastEmitted = serialized;
      deps.onStateChange(state);
    }
    return state;
  }

  function closeSocket(): void {
    if (activeRoomId !== null) {
      attempts.cancel(activeRoomId);
      activeRoomId = null;
    }
    if (socket) {
      socket.close();
      socket = null;
    }
    socketOpen = false;
    mobilePresent = false;
  }

  /** Best-effort `room_teardown` so the Worker forgets the credential hash
   * and closes every peer — the old pairing string stops working. */
  function teardownRoom(): void {
    if (socket && socket.readyState === SOCKET_OPEN) {
      socket.send(serializeMessage({ v: PROTOCOL_VERSION, type: "room_teardown" }));
    }
  }

  function handleErrorMessage(message: ErrorMessage): void {
    switch (message.code) {
      case "version_mismatch":
        fatalError = "Protocol version mismatch — update Inteligir to keep using Remote Access.";
        emitState();
        break;
      case "room_closed":
        // The room was torn down out from under us (rotation from elsewhere,
        // or relay-side cleanup). The credential is dead; the user must
        // rotate to mint a fresh one.
        fatalError = "The pairing was revoked — rotate to generate a new pairing string.";
        emitState();
        break;
      default:
        // Transient/operational errors (rate_limited, invalid_message,
        // payload_too_large, unauthorized) — log, stay connected.
        console.warn(`[dispatch] relay error: ${message.code} — ${message.message}`);
    }
  }

  function handleInbound(message: DispatchMessage): void {
    switch (message.type) {
      case "presence":
        mobilePresent = message.peers.some((peer) => peer.role === "mobile");
        emitState();
        break;
      case "peer_joined":
        if (message.role === "mobile") {
          mobilePresent = true;
          emitState();
        }
        break;
      case "peer_left":
        if (message.role === "mobile") {
          mobilePresent = false;
          emitState();
        }
        break;
      case "error":
        handleErrorMessage(message);
        break;
      case "user_message":
      case "steer":
      case "interrupt":
      case "chat_message":
        handler?.(message);
        break;
      // Not addressed to the desktop role; a conforming relay never sends
      // these to us. Drop silently.
      case "agent_event":
      case "chat_reply":
      case "room_teardown":
        break;
    }
  }

  function connect(cred: PairingCredential): void {
    closeSocket();
    const attempt = attempts.begin(cred.roomId);
    activeRoomId = cred.roomId;
    socketOpen = false;
    mobilePresent = false;
    fatalError = null;

    const next = deps.createSocket(
      buildConnectionConfig({
        host: deps.host(),
        roomId: cred.roomId,
        role: "desktop",
        token: cred.token,
      }),
    );
    socket = next;

    next.addEventListener("open", () => {
      if (!attempt.isCurrent()) return;
      socketOpen = true;
      // A fresh socket has no peer knowledge; the server's presence snapshot
      // (sent on connect) re-gates streaming.
      mobilePresent = false;
      emitState();
    });

    next.addEventListener("message", (event) => {
      if (!attempt.isCurrent()) return;
      const result = parseMessage(event.data);
      if (!result.ok) {
        console.warn(`[dispatch] dropped invalid frame (${result.error.code})`);
        return;
      }
      handleInbound(result.message);
    });

    next.addEventListener("close", (event) => {
      if (!attempt.isCurrent()) return;
      if (event.code === CLOSE_POLICY_VIOLATION) {
        // The relay refused this credential (stale token after a remote
        // rotation, or a malformed room id). PartySocket would otherwise
        // redial the same dead credential forever, pinning the UI on
        // "connecting" — stop the socket and surface a needs-rotate state.
        fatalError =
          `The relay rejected this pairing${event.reason ? ` (${event.reason})` : ""} — ` +
          "rotate to generate a new pairing string.";
        closeSocket();
        emitState();
        return;
      }
      // PartySocket auto-reconnects; presence resets until it does.
      socketOpen = false;
      mobilePresent = false;
      emitState();
    });
  }

  return {
    init(inboundHandler: DispatchInboundHandler): void {
      handler = inboundHandler;
      const stored = deps.store.read();
      enabled = stored.enabled;
      credential = stored.credential;
      if (enabled && credential) {
        connect(credential);
      }
      emitState();
    },

    getState(): DispatchState {
      return currentState();
    },

    setEnabled(nextEnabled: boolean): DispatchState {
      if (nextEnabled === enabled) return currentState();
      if (nextEnabled) {
        credential = generatePairingCredential();
        enabled = true;
        deps.store.write({ version: 1, enabled: true, credential });
        connect(credential);
      } else {
        teardownRoom();
        closeSocket();
        enabled = false;
        credential = null;
        fatalError = null;
        deps.store.write({ version: 1, enabled: false, credential: null });
      }
      return emitState();
    },

    rotateCredential(): DispatchState {
      if (!enabled) return currentState();
      teardownRoom();
      credential = generatePairingCredential();
      deps.store.write({ version: 1, enabled: true, credential });
      connect(credential);
      return emitState();
    },

    sendAgentEvent(event: AgentEvent): void {
      // The presence gate: transcript bytes only leave the machine while an
      // authenticated mobile peer is in the room.
      if (!enabled || !socket || socket.readyState !== SOCKET_OPEN || !mobilePresent) return;
      const raw = serializeMessage({ v: PROTOCOL_VERSION, type: "agent_event", event });
      if (frameTooLarge(raw)) {
        console.warn(`[dispatch] dropped oversized agent_event (${event.type})`);
        return;
      }
      socket.send(raw);
    },

    sendChatReply(correlationId: string, text: string): void {
      // chat_reply goes to the relay DO itself (not a peer), so it is not
      // gated on mobile presence — only on a live authenticated socket.
      if (!enabled || !socket || socket.readyState !== SOCKET_OPEN) return;
      const raw = serializeMessage({
        v: PROTOCOL_VERSION,
        type: "chat_reply",
        correlationId,
        text,
      });
      if (frameTooLarge(raw)) {
        console.warn("[dispatch] dropped oversized chat_reply");
        return;
      }
      socket.send(raw);
    },

    shutdown(): void {
      // App quit — keep the room claimed so the next launch reconnects with
      // the same credential. (Disable/rotate are the paths that kill it.)
      closeSocket();
      handler = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Module singleton wired to real deps (Electron main process)
// ---------------------------------------------------------------------------

// Packaged builds hit the deployed Worker; dev hits local `wrangler dev`.
// DISPATCH_SERVER_HOST overrides either (e.g. staging). Resolved lazily so
// `app.isPackaged` isn't read at module load (it throws outside an Electron
// runtime, e.g. under vitest).
function serverHost(): string {
  return (
    process.env["DISPATCH_SERVER_HOST"] ??
    (app.isPackaged ? PRODUCTION_SERVER_HOST : DEFAULT_SERVER_HOST)
  );
}

let singleton: DispatchClient | null = null;

function getClient(): DispatchClient {
  if (singleton) return singleton;
  const store = new JsonStore<DispatchStore>(
    inteligirPath("dispatch-room.json"),
    DispatchStoreSchema,
    DISPATCH_STORE_DEFAULT,
    { versioning: DISPATCH_STORE_VERSIONING },
  );
  singleton = createDispatchClient({
    store,
    host: serverHost,
    createSocket: (config) => new PartySocket(config),
    onStateChange: (state) => broadcast("onDispatchState", state),
  });
  return singleton;
}

/** Wire the inbound handler and reconnect if Remote Access was left enabled.
 * With Remote Access off (the default) this opens no socket. */
export function initDispatch(handler: DispatchInboundHandler): void {
  getClient().init(handler);
}

export function getDispatchState(): DispatchState {
  return getClient().getState();
}

/** Toggle Remote Access. Enabling mints a fresh pairing credential and
 * connects; disabling tears the room down and forgets the credential. */
export function setRemoteAccessEnabled(enabled: boolean): DispatchState {
  return getClient().setEnabled(enabled);
}

/** Rotate: tear down the current room (old pairing string dies) and claim a
 * fresh one under a new credential. */
export function rotateDispatchCredential(): DispatchState {
  return getClient().rotateCredential();
}

/** Forward one agent transcript event to the mobile peer. No-op unless an
 * authenticated mobile peer is present (see presence gate in the client). */
export function sendDispatchResponse(event: AppAgentEvent): void {
  // AppAgentEvent is structurally a wire AgentEvent (the protocol schema is
  // its projection), so this assignment is checked — no cast.
  const wireEvent: AgentEvent = event;
  getClient().sendAgentEvent(wireEvent);
}

/**
 * Answer a relayed `chat_message` with the agent's final text. The relay DO
 * matches it back to the waiting gateway request by `correlationId`. No-op
 * when disconnected — the gateway request times out and surfaces an error to
 * the user on the messaging platform.
 */
export function sendChatReply(correlationId: string, text: string): void {
  getClient().sendChatReply(correlationId, text);
}

export function shutdownDispatch(): void {
  singleton?.shutdown();
}
