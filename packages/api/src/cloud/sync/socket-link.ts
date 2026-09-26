import type { CloudSocket, CloudSocketOpener, OpenCloudSocketArgs } from "../cloud-client";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "./sync-ws";
import type { SocketListener } from "./sync-ws";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;

export interface SocketLinkArgs {
  baseUrl: string;
  /** null is poll-only; the socket carries only invalidation pings. */
  openSocket: CloudSocketOpener | null;
  /** read at every dial, so a choice the upgrade announces is the one current when it dials. */
  listener: () => SocketListener;
  canConnect: () => boolean;
  credential: () => string | null;
  onPing: OpenCloudSocketArgs["onPing"];
  onSevered: () => void;
  /** a socket this link dialled opened, or one that had opened dropped; close() reports neither. */
  onConnectionChanged: (connected: boolean) => void;
}

export interface SocketLink {
  connect: () => void;
  close: () => void;
  resetBackoff: () => void;
  isConnected: () => boolean;
}

export const createSocketLink = (args: SocketLinkArgs): SocketLink => {
  let socket: CloudSocket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let socketGeneration = 0;

  const connect = (): void => {
    if (!args.canConnect() || socket !== null || args.openSocket === null) {
      return;
    }
    const credential = args.credential();
    if (credential === null) {
      return;
    }
    const scheduleReconnect = (): void => {
      if (!args.canConnect() || args.openSocket === null || reconnectTimer !== null) {
        return;
      }
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
    // an opener may report a terminal failure before it returns; without the
    // generation the assignment below overwrites the null its own onClose just wrote.
    const generation = socketGeneration + 1;
    socketGeneration = generation;
    const opened = args.openSocket({
      baseUrl: args.baseUrl,
      credential,
      listener: args.listener(),
      onClose: (code) => {
        if (generation !== socketGeneration) {
          return;
        }
        socketGeneration += 1;
        socket = null;
        const wasConnected = connected;
        connected = false;
        if (wasConnected) {
          args.onConnectionChanged(false);
        }
        if (code === SYNC_WS_REVOKED_CLOSE_CODE) {
          args.onSevered();
        }
        scheduleReconnect();
      },
      onOpen: () => {
        if (generation !== socketGeneration) {
          return;
        }
        connected = true;
        reconnectAttempt = 0;
        args.onConnectionChanged(true);
      },
      onPing: args.onPing,
    });
    if (generation === socketGeneration) {
      socket = opened;
    }
  };

  return {
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

    connect,

    isConnected: () => connected,

    resetBackoff() {
      reconnectAttempt = 0;
    },
  };
};
