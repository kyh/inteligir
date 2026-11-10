// A WebSocket constructor for a client inside workerd, which YProvider takes as its polyfill. A
// suite's `new WebSocket(url)` would dial the network, so this one upgrades through the Worker's own
// fetch (`exports.default.fetch`), accepts the client end and dispatches its events again, adding
// the `open` a fetched socket never fires and the instance `OPEN` YProvider compares its state to.
// It records every frame each way and each close, and can hold what it sends, so two writers meet
// concurrently.

import { exports } from "cloudflare:workers";

type Frame = ArrayBuffer | ArrayBufferView | string;

export interface SocketTrace {
  readonly sent: Frame[];
  readonly received: (ArrayBuffer | string)[];
  readonly closes: number[];
}

// by the url's `_pk`, YProvider's connection id
export const traces = new Map<string, SocketTrace>();
// how many sockets each connection id opened, so a suite sees a reconnect
export const opens = new Map<string, number>();

const held = new Map<string, Frame[]>();
const sockets = new Map<string, FetchWebSocket>();

export const holdSends = (connectionId: string): void => {
  held.set(connectionId, []);
};

export const releaseSends = (connectionId: string): void => {
  const queue = held.get(connectionId) ?? [];
  held.delete(connectionId);
  const socket = sockets.get(connectionId);
  for (const message of queue) {
    socket?.send(message);
  }
};

const nothing = (): void => {};
const noAttachment = (): null => null;

const connectionIdOf = (url: string): string => new URL(url).searchParams.get("_pk") ?? url;

export class FetchWebSocket extends EventTarget<WebSocketEventMap> implements WebSocket {
  static readonly READY_STATE_CONNECTING = 0;
  static readonly CONNECTING = 0;
  static readonly READY_STATE_OPEN = 1;
  static readonly OPEN = 1;
  static readonly READY_STATE_CLOSING = 2;
  static readonly CLOSING = 2;
  static readonly READY_STATE_CLOSED = 3;
  static readonly CLOSED = 3;

  // YProvider reads `ws.OPEN` off the instance, as a browser's socket has it
  readonly OPEN = 1;

  readyState = FetchWebSocket.CONNECTING;
  url: string | null;
  protocol: string | null = null;
  extensions: string | null = null;
  binaryType: "blob" | "arraybuffer" = "arraybuffer";

  #socket: WebSocket | null = null;
  readonly #id: string;
  readonly #trace: SocketTrace;

  constructor(url: string) {
    super();
    this.url = url;
    this.#id = connectionIdOf(url);
    this.#trace = traces.get(this.#id) ?? { closes: [], received: [], sent: [] };
    traces.set(this.#id, this.#trace);
    opens.set(this.#id, (opens.get(this.#id) ?? 0) + 1);
    sockets.set(this.#id, this);
    void this.#open(url);
  }

  async #open(url: string): Promise<void> {
    const http = new URL(url);
    http.protocol = http.protocol === "ws:" ? "http:" : "https:";
    const response = await exports.default.fetch(http.toString(), {
      headers: { upgrade: "websocket" },
    });
    const socket = response.webSocket;
    if (socket === null) {
      this.readyState = FetchWebSocket.CLOSED;
      this.#trace.closes.push(response.status);
      this.dispatchEvent(new Event("error"));
      this.dispatchEvent(new CloseEvent("close", { code: 1006, reason: String(response.status) }));
      return;
    }
    socket.accept();
    // workerd hands binary frames over as Blobs by default, which YProvider reads as no bytes
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      this.#trace.received.push(event.data);
      this.dispatchEvent(new MessageEvent("message", { data: event.data }));
    });
    socket.addEventListener("close", (event) => {
      this.readyState = FetchWebSocket.CLOSED;
      this.#trace.closes.push(event.code);
      this.dispatchEvent(
        new CloseEvent("close", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        }),
      );
    });
    socket.addEventListener("error", () => {
      this.dispatchEvent(new Event("error"));
    });
    this.readyState = FetchWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  // accepted as it opens
  readonly accept = nothing;

  send(message: Frame): void {
    const queue = held.get(this.#id);
    if (queue !== undefined) {
      queue.push(message);
      return;
    }
    this.#trace.sent.push(message);
    this.#socket?.send(message);
  }

  close(code?: number, reason?: string): void {
    this.readyState = FetchWebSocket.CLOSING;
    this.#socket?.close(code, reason);
  }

  readonly serializeAttachment = nothing;

  readonly deserializeAttachment = noAttachment;
}
