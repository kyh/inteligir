// ---------------------------------------------------------------------------
// WS Bridge client — the Bridge implementation over a WebSocket, derived from
// the IPC registry. Isomorphic: no node imports — the browser workspace and a
// React Native client both run this, injecting their WebSocket implementation.
// A reconnect supervisor (the ONLY retry owner) keeps one socket alive with
// exponential backoff; requests made while disconnected queue until the
// server's welcome, and event subscriptions survive reconnects.
//
// Every connection begins by MINTING a ticket, because a ticket is spent by the
// socket it opens: a reconnect cannot replay the last one, so the credential is
// a function rather than a value. That is also where a dead session is
// discovered — the minter says `unauthorized`, and the supervisor stops before
// it dials rather than after.
// ---------------------------------------------------------------------------

import { createBackoff, timeoutSchedule } from "./backoff";
import { IPC, binaryChannelFor, binaryChannelForTag, type Bridge } from "./ipc-registry";
import { isRecord } from "./wire-helpers";
import {
  WS_CLOSE_UNAUTHORIZED,
  decodeBinaryFrame,
  encodeBinaryFrame,
  encodeFrame,
  parseServerFrame,
  type ReqFrame,
  type ServerFrame,
} from "./ws-protocol";

// Minimal structural WebSocket surface — satisfied by the browser/React
// Native WebSocket and by the `ws` package's client (tests inject it).
// Method shorthand keeps parameter checks bivariant across those libs; the
// send parameter is exactly what this bridge emits (text frames + framed
// binary), the intersection every implementation accepts.
export type WsLike = {
  binaryType: string;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    // `type` rides along so every implementation's event classes structurally
    // overlap this weak type; only `data` (message frames) and `code` (close
    // frames — auth rejection is a distinct close code) are consumed.
    listener: (event: { data?: unknown; type?: string; code?: number }) => void,
  ): void;
};

export type WsConstructor = new (url: string) => WsLike;

/** `unauthorized` is terminal: the session behind the ticket is gone, so the
 * supervisor stops — re-presenting a dead credential forever helps no one. */
export type WsBridgeStatus = "connecting" | "connected" | "disconnected" | "unauthorized";

/**
 * A freshly minted socket ticket, or why there is none.
 *
 * The two failures are answered differently and so cannot share a shape:
 * `unauthorized` means the session is gone and no amount of retrying will
 * produce a ticket, while `unavailable` is the network between here and the
 * host. Collapsing them would either strand a signed-in user on a blip or spin
 * forever against a dead session.
 */
export type MintedTicket =
  | { readonly ok: true; readonly ticket: string }
  | { readonly ok: false; readonly reason: "unauthorized" | "unavailable" };

/** Mints the single-use ticket the next socket authenticates with. Called once
 * per connection ATTEMPT, because a ticket is spent by the socket it opens. */
export type TicketMinter = () => Promise<MintedTicket>;

export type WsBridgeOptions = {
  url: string;
  mintTicket: TicketMinter;
  /** Defaults to globalThis.WebSocket (browser / React Native / node ≥ 22). */
  webSocketImpl?: WsConstructor;
  /** Fires on every status transition. */
  onStatus?: (status: WsBridgeStatus) => void;
};

const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 16_000;
const QUEUE_CAP = 256;

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function createWsBridge(options: WsBridgeOptions): { bridge: Bridge; dispose: () => void } {
  const WebSocketImpl = options.webSocketImpl ?? globalThis.WebSocket;

  let disposed = false;
  // Terminal: the session is gone — no further connection attempts, and every
  // request rejects immediately.
  let unauthorized = false;
  let sock: WsLike | null = null;
  // Welcomed = the server accepted our auth frame; only then may requests flow.
  let welcomed = false;
  let status: WsBridgeStatus | null = null;
  const reconnect = createBackoff({
    baseMs: RECONNECT_BASE_MS,
    capMs: RECONNECT_CAP_MS,
    schedule: timeoutSchedule,
  });
  let nextId = 1;

  /** Requests sent and awaiting a res frame — rejected if the socket drops. */
  const inflight = new Map<number, Pending>();
  /** Requests made while disconnected — flushed on welcome, capped. */
  const queue: Array<{ frame: ReqFrame; pending: Pending }> = [];
  const eventListeners = new Map<string, Set<(event: unknown) => void>>();

  function setStatus(next: WsBridgeStatus): void {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  }

  function connect(): void {
    if (disposed || unauthorized) return;
    setStatus("connecting");
    void mintThenDial();
  }

  /** Mint first, dial second. A socket opened before the ticket is in hand
   * would sit against the host's auth deadline waiting for one, and a mint that
   * fails would have to close a connection it should never have made. */
  async function mintThenDial(): Promise<void> {
    const minted = await options.mintTicket().catch((): MintedTicket => {
      return { ok: false, reason: "unavailable" };
    });
    if (disposed || unauthorized) return;
    if (!minted.ok) {
      if (minted.reason === "unauthorized") handleUnauthorized();
      else handleDisconnect();
      return;
    }
    dial(minted.ticket);
  }

  function dial(ticket: string): void {
    const socket = new WebSocketImpl(options.url);
    sock = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      if (socket !== sock) return;
      socket.send(encodeFrame({ t: "auth", ticket }));
    });
    socket.addEventListener("message", (event) => {
      if (socket !== sock) return;
      handleMessage(event.data);
    });
    socket.addEventListener("close", (event) => {
      if (socket !== sock) return;
      if (event.code === WS_CLOSE_UNAUTHORIZED) {
        handleUnauthorized();
        return;
      }
      handleDisconnect();
    });
    // A close event always follows; the listener only prevents an unhandled
    // error crash under node's ws implementation.
    socket.addEventListener("error", () => {});
  }

  /** Reject every request awaiting a res frame (the socket is gone). */
  function drainInflight(message: (method: string) => string): void {
    const dropped = [...inflight.values()];
    inflight.clear();
    for (const pending of dropped) {
      pending.reject(new Error(message(pending.method)));
    }
  }

  /** Terminal teardown shared by handleUnauthorized and dispose: stop the
   * supervisor, reject everything in flight OR queued, publish the status. */
  function failAll(next: WsBridgeStatus, message: (method: string) => string): void {
    welcomed = false;
    reconnect.cancel();
    const queued = queue.map((item) => item.pending);
    queue.length = 0;
    drainInflight(message);
    for (const pending of queued) {
      pending.reject(new Error(message(pending.method)));
    }
    setStatus(next);
  }

  function handleDisconnect(): void {
    sock = null;
    welcomed = false;
    setStatus("disconnected");
    drainInflight((method) => `[ws-bridge] connection lost before "${method}" resolved`);
    scheduleReconnect();
  }

  /** Auth rejection is terminal — the session behind the ticket is gone, so
   * the next mint would fail exactly as this one did. */
  function handleUnauthorized(): void {
    unauthorized = true;
    sock = null;
    failAll("unauthorized", (method) => `[ws-bridge] unauthorized — "${method}" rejected`);
  }

  function scheduleReconnect(): void {
    if (disposed || unauthorized) return;
    reconnect.schedule(connect);
  }

  function handleMessage(data: unknown): void {
    if (typeof data === "string") {
      const frame = parseServerFrame(data);
      if (frame !== null) handleFrame(frame);
      return;
    }
    if (data instanceof ArrayBuffer) {
      const decoded = decodeBinaryFrame(data);
      if (decoded === null) return;
      const channel = binaryChannelForTag(decoded.tag);
      // Unknown tag = a channel this client's registry doesn't have; drop it.
      if (channel === undefined) return;
      dispatchEvent(
        channel.method,
        "field" in channel ? { [channel.field]: decoded.payload } : decoded.payload,
      );
    }
  }

  function handleFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case "welcome":
        welcomed = true;
        reconnect.reset();
        setStatus("connected");
        flushQueue();
        return;
      case "res": {
        const pending = inflight.get(frame.id);
        if (pending === undefined) return;
        inflight.delete(frame.id);
        if (frame.ok) pending.resolve(frame.result);
        else pending.reject(new Error(frame.error));
        return;
      }
      case "evt":
        dispatchEvent(frame.method, frame.payload);
        return;
    }
  }

  function flushQueue(): void {
    const socket = sock;
    if (!welcomed || socket === null) return;
    for (const item of queue.splice(0)) {
      inflight.set(item.frame.id, item.pending);
      socket.send(encodeFrame(item.frame));
    }
  }

  function dispatchEvent(method: string, payload: unknown): void {
    const set = eventListeners.get(method);
    if (set === undefined) return;
    for (const listener of set) listener(payload);
  }

  function request(method: string, payload: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (disposed) {
        reject(new Error(`[ws-bridge] disposed — "${method}" not sent`));
        return;
      }
      if (unauthorized) {
        reject(new Error(`[ws-bridge] unauthorized — "${method}" not sent`));
        return;
      }
      const id = nextId;
      nextId += 1;
      const frame: ReqFrame =
        payload === undefined ? { t: "req", id, method } : { t: "req", id, method, payload };
      const pending: Pending = { method, resolve, reject };
      if (welcomed && sock !== null) {
        inflight.set(id, pending);
        sock.send(encodeFrame(frame));
        return;
      }
      if (queue.length >= QUEUE_CAP) {
        const oldest = queue.shift();
        oldest?.pending.reject(
          new Error(`[ws-bridge] request queue overflow — "${oldest.frame.method}" dropped`),
        );
      }
      queue.push({ frame, pending });
    });
  }

  // Fire-and-forget frames are dropped while disconnected (queueing stale
  // audio or tts control frames for a later socket would be worse).
  function sendFrame(method: string, payload: unknown): void {
    if (!welcomed || sock === null) return;
    sock.send(encodeFrame({ t: "send", method, payload }));
  }

  /** Send a BINARY_CHANNELS payload as a tagged binary frame. Non-buffer
   * payloads are dropped rather than silently JSON-encoded — the receiving
   * side only decodes bytes for these methods. */
  function sendBinary(method: string, payload: unknown): void {
    if (!welcomed || sock === null) return;
    const channel = binaryChannelFor(method);
    if (channel === undefined) return;
    const buffer = "field" in channel && isRecord(payload) ? payload[channel.field] : payload;
    if (buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)) {
      sock.send(encodeBinaryFrame(channel.tag, buffer));
    }
  }

  function subscribe(method: string, listener: (event: unknown) => void): () => void {
    let set = eventListeners.get(method);
    if (set === undefined) {
      set = new Set();
      eventListeners.set(method, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  // Auto-construct the bridge from the registry. Each entry's `kind` decides
  // the wire mechanism; the registry's per-entry typing flows into Bridge
  // via the `as Bridge` at the end (the runtime shape exactly matches
  // what the derivation produces).
  const entries = Object.entries(IPC).map(([method, def]) => {
    switch (def.kind) {
      case "invoke":
        return [method, (payload: unknown) => request(method, payload)] as const;
      case "invoke-void":
        return [method, () => request(method, undefined)] as const;
      case "send":
        return binaryChannelFor(method) !== undefined
          ? ([method, (payload: unknown) => sendBinary(method, payload)] as const)
          : ([method, (payload: unknown) => sendFrame(method, payload)] as const);
      case "event":
        return [
          method,
          (listener: (event: unknown) => void) => subscribe(method, listener),
        ] as const;
    }
  });

  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- runtime fold over the registry; shape proven by derivation above
  const bridge = Object.fromEntries(entries) as unknown as Bridge;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const socket = sock;
    sock = null;
    socket?.close(1000, "disposed");
    failAll("disconnected", (method) => `[ws-bridge] disposed — "${method}" not sent`);
    eventListeners.clear();
  }

  connect();

  return { bridge, dispose };
}
