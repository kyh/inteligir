import { serverMessageLenientSchema } from "@repo/contract/local/notifications";
import type {
  ChangedMessage,
  ClientMessage,
  RealtimeSubscriptionTarget,
} from "@repo/contract/local/notifications";
import { z } from "zod";

const encodeFrame = (frame: ClientMessage): string => JSON.stringify(frame);

export interface InvalidationSocket {
  send: (data: string) => void;
  close: () => void;
  onOpen: (() => void) | null;
  onMessage: ((event: { data: unknown }) => void) | null;
  onClose: (() => void) | null;
}

export interface InvalidationClientArgs {
  targets: readonly RealtimeSubscriptionTarget[];
  createSocket: () => InvalidationSocket;
  onChanged: (message: ChangedMessage) => void;
  // re-connects only: whatever changed in the gap produced no frames, so the consumer must invalidate.
  onReconnected?: () => void;
  reconnectDelayMs?: (attempt: number) => number;
}

const defaultReconnectDelayMs = (attempt: number): number => Math.min(500 * 2 ** attempt, 10_000);

export class InvalidationClient {
  private readonly args: InvalidationClientArgs;
  private socket: InvalidationSocket | null = null;
  private hasConnectedBefore = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(args: InvalidationClientArgs) {
    this.args = args;
  }

  start(): void {
    if (this.disposed || this.socket !== null) {
      return;
    }
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
  }

  private connect(): void {
    const socket = this.args.createSocket();
    this.socket = socket;
    socket.onOpen = () => {
      this.reconnectAttempt = 0;
      for (const target of this.args.targets) {
        socket.send(encodeFrame({ target, type: "subscribe" }));
      }
      if (this.hasConnectedBefore) {
        this.args.onReconnected?.();
      }
      this.hasConnectedBefore = true;
    };
    socket.onMessage = (event) => {
      const frame = z.string().safeParse(event.data);
      if (!frame.success) {
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(frame.data);
      } catch {
        return;
      }
      const parsed = serverMessageLenientSchema.safeParse(decoded);
      if (parsed.success && parsed.data.type === "changed") {
        this.args.onChanged(parsed.data);
      }
    };
    socket.onClose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }
    const delayMs = (this.args.reconnectDelayMs ?? defaultReconnectDelayMs)(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) {
        this.connect();
      }
    }, delayMs);
  }

  private teardownSocket(): void {
    const { socket } = this;
    if (socket === null) {
      return;
    }
    this.socket = null;
    socket.onOpen = null;
    socket.onMessage = null;
    socket.onClose = null;
    socket.close();
  }
}

export const browserInvalidationSocket = (url: string): InvalidationSocket => {
  const ws = new WebSocket(url);
  const adapter: InvalidationSocket = {
    close: () => {
      ws.close();
    },
    onClose: null,
    onMessage: null,
    onOpen: null,
    send: (data) => {
      ws.send(data);
    },
  };
  ws.addEventListener("open", () => adapter.onOpen?.());
  ws.addEventListener("message", (event) => adapter.onMessage?.({ data: event.data }));
  ws.addEventListener("close", () => adapter.onClose?.());
  return adapter;
};
