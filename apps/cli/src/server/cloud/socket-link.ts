import type { CloudSocket, CloudSocketOpener, OpenCloudSocketArgs } from "@repo/api/cloud/client";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

// rfc 6455 policy violation, what the cloud closes a revoked device's socket
// with. a hint, not the verdict — the next http call establishes it.
const SEVERED_CLOSE_CODE = 1008;

export interface SocketLinkArgs {
  baseUrl: string;
  /** null is poll-only; the socket carries only invalidation pings. */
  openSocket: CloudSocketOpener | null;
  platform: OpenCloudSocketArgs["platform"];
  canConnect(): boolean;
  credential(): string | null;
  onPing: OpenCloudSocketArgs["onPing"];
  onSevered(): void;
}

export interface SocketLink {
  connect(): void;
  close(): void;
  resetBackoff(): void;
  isConnected(): boolean;
}

export function createSocketLink(args: SocketLinkArgs): SocketLink {
  let socket: CloudSocket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
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
    // an opener may report a terminal failure before it returns; without the
    // generation the assignment below overwrites the null its own onClose just wrote.
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
