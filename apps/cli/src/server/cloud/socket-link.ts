// One responsibility: the invalidation socket's LINK — dialling, the
// reconnect backoff, and the generation counter that keeps a dead handle
// from shadowing a live one. What a frame MEANS belongs to the runtime; this
// module only reports "connected", hands pings through, and says when a
// close looked like the cloud severing a revoked device.

import type { CloudSocket, CloudSocketOpener, OpenCloudSocketArgs } from "@repo/api/cloud/client";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

/** RFC 6455 policy violation — what the cloud closes a revoked device's socket
 *  with. Treated as a hint, never as the verdict: the next HTTP call is what
 *  actually establishes that a credential is dead. */
const SEVERED_CLOSE_CODE = 1008;

export interface SocketLinkArgs {
  baseUrl: string;
  /** null is poll-only — correct rather than degraded, since the socket
   *  carries invalidation pings and nothing else. */
  openSocket: CloudSocketOpener | null;
  platform: OpenCloudSocketArgs["platform"];
  /** Whether a dial (or a reconnect) may happen at all right now. */
  canConnect(): boolean;
  /** The live session's credential, or null when there is none to dial with. */
  credential(): string | null;
  onPing: OpenCloudSocketArgs["onPing"];
  /** The socket closed with {@link SEVERED_CLOSE_CODE}. */
  onSevered(): void;
}

export interface SocketLink {
  connect(): void;
  /** Close the socket and cancel any armed reconnect. */
  close(): void;
  /** A fresh pairing starts its backoff from the beginning. */
  resetBackoff(): void;
  isConnected(): boolean;
}

export function createSocketLink(args: SocketLinkArgs): SocketLink {
  let socket: CloudSocket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  /** Which dial the live callbacks belong to — see `connect`. */
  let socketGeneration = 0;

  function scheduleReconnect(): void {
    if (!args.canConnect() || args.openSocket === null || reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    reconnectTimer.unref?.();
  }

  function connect(): void {
    if (!args.canConnect() || socket !== null || args.openSocket === null) {
      return;
    }
    const credential = args.credential();
    if (credential === null) {
      return;
    }
    // A generation, because an opener may report a terminal failure BEFORE it
    // returns: the assignment below would then overwrite the null its own
    // `onClose` just wrote, and this link would hold a dead handle it never
    // replaces. Bumping the counter from inside the callback makes the
    // assignment refuse itself.
    const generation = socketGeneration + 1;
    socketGeneration = generation;
    const opened = args.openSocket({
      baseUrl: args.baseUrl,
      credential,
      platform: args.platform,
      onOpen: () => {
        if (generation !== socketGeneration) {
          return;
        }
        connected = true;
        reconnectAttempt = 0;
      },
      onPing: args.onPing,
      onClose: (code) => {
        if (generation !== socketGeneration) {
          return;
        }
        socketGeneration += 1;
        socket = null;
        connected = false;
        if (code === SEVERED_CLOSE_CODE) {
          args.onSevered();
        }
        scheduleReconnect();
      },
    });
    if (generation === socketGeneration) {
      socket = opened;
    }
  }

  return {
    connect,

    close() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socketGeneration += 1;
      socket?.close();
      socket = null;
      connected = false;
    },

    resetBackoff() {
      reconnectAttempt = 0;
    },

    isConnected: () => connected,
  };
}
