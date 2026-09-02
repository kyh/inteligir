import {
  realtimeSubscriptionTargetKey,
  serverMessageLenientSchema,
  type ChangedMessage,
  type RealtimeSubscriptionTarget,
} from "@repo/api/local/notifications";
import { z } from "zod";

export interface InvalidationSocket {
  send(data: string): void;
  close(): void;
  onOpen: (() => void) | null;
  onMessage: ((event: { data: unknown }) => void) | null;
  onClose: (() => void) | null;
}

export interface InvalidationClientArgs {
  createSocket: () => InvalidationSocket;
  onChanged: (message: ChangedMessage) => void;
  // re-connects only: whatever changed in the gap produced no frames, so the consumer must invalidate.
  onReconnected?: (targets: readonly RealtimeSubscriptionTarget[]) => void;
  reconnectDelayMs?: (attempt: number) => number;
}

const defaultReconnectDelayMs = (attempt: number): number => Math.min(500 * 2 ** attempt, 10_000);

interface HeldTarget {
  target: RealtimeSubscriptionTarget;
  count: number;
}

export class InvalidationClient {
  private readonly args: InvalidationClientArgs;
  private readonly held = new Map<string, HeldTarget>();
  private socket: InvalidationSocket | null = null;
  private socketOpen = false;
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

  subscribe(target: RealtimeSubscriptionTarget): () => void {
    const key = realtimeSubscriptionTargetKey(target);
    const existing = this.held.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      this.held.set(key, { target, count: 1 });
      this.sendFrame({ type: "subscribe", target });
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const holder = this.held.get(key);
      if (!holder) {
        return;
      }
      holder.count -= 1;
      if (holder.count === 0) {
        this.held.delete(key);
        this.sendFrame({ type: "unsubscribe", target });
      }
    };
  }

  private connect(): void {
    const socket = this.args.createSocket();
    this.socket = socket;
    this.socketOpen = false;
    socket.onOpen = () => {
      this.socketOpen = true;
      this.reconnectAttempt = 0;
      const targets = [...this.held.values()].map((holder) => holder.target);
      for (const target of targets) {
        socket.send(JSON.stringify({ type: "subscribe", target }));
      }
      if (this.hasConnectedBefore) {
        this.args.onReconnected?.(targets);
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
      this.socketOpen = false;
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

  private sendFrame(frame: {
    type: "subscribe" | "unsubscribe";
    target: RealtimeSubscriptionTarget;
  }): void {
    // not queued when closed: the open handler replays every held target.
    if (this.socket !== null && this.socketOpen) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private teardownSocket(): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    this.socket = null;
    this.socketOpen = false;
    socket.onOpen = null;
    socket.onMessage = null;
    socket.onClose = null;
    socket.close();
  }
}

export function browserInvalidationSocket(url: string): InvalidationSocket {
  const ws = new WebSocket(url);
  const adapter: InvalidationSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: null,
    onMessage: null,
    onClose: null,
  };
  ws.addEventListener("open", () => adapter.onOpen?.());
  ws.addEventListener("message", (event) => adapter.onMessage?.({ data: event.data }));
  ws.addEventListener("close", () => adapter.onClose?.());
  return adapter;
}
