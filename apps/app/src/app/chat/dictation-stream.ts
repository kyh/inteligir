// The client half of the dictation stream: one socket to `/voice/stream` that
// carries PCM16 frames UP and `partial`/`final`/`error` messages DOWN.
//
// The socket is INJECTED (a factory), so the whole lifecycle is unit-testable
// with a fake — the same shape the invalidation client uses. Exactly one of
// `onFinal`/`onError` fires, and it is terminal: the client closes the socket
// after either, and a `cancel` (release-to-cancel, or an unmount) closes it with
// nothing delivered. Frames pushed before the socket opens are queued and
// flushed on open, and a `finalize` that races the open is held behind them so
// the server sees every frame before it is asked for the final.

import { VOICE_STREAM_PATH, voiceStreamDownMessageSchema } from "@repo/server-contract/voice";
import { z } from "zod";

/** The slice of the WebSocket surface this client drives; the browser's
 *  WebSocket satisfies it, tests hand in a scriptable fake. */
export interface DictationSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  onOpen: (() => void) | null;
  onMessage: ((event: { data: unknown }) => void) | null;
  onClose: (() => void) | null;
  onError: (() => void) | null;
}

export interface DictationStreamHandlers {
  /** A growing preview; rewrites as more audio arrives. */
  onPartial(text: string): void;
  /** The authoritative transcript, on release. Terminal. */
  onFinal(text: string): void;
  /** A refusal (a server `error` frame, or the connection dropping before a
   *  final). Terminal. Never fired for a `cancel`. */
  onError(message: string): void;
}

export interface DictationStreamClientArgs {
  createSocket: () => DictationSocket;
  handlers: DictationStreamHandlers;
}

export class DictationStreamClient {
  readonly #createSocket: () => DictationSocket;
  readonly #handlers: DictationStreamHandlers;
  #socket: DictationSocket | null = null;
  #open = false;
  #settled = false;
  #cancelled = false;
  #finalizeRequested = false;
  #finalizing = false;
  #pending: ArrayBuffer[] = [];

  constructor(args: DictationStreamClientArgs) {
    this.#createSocket = args.createSocket;
    this.#handlers = args.handlers;
  }

  start(): void {
    if (this.#socket !== null) {
      return;
    }
    const socket = this.#createSocket();
    this.#socket = socket;
    socket.onOpen = () => {
      this.#open = true;
      for (const pcm of this.#pending) {
        socket.send(pcm);
      }
      this.#pending = [];
      if (this.#finalizeRequested) {
        socket.send(JSON.stringify({ type: "finalize" }));
      }
    };
    socket.onMessage = (event) => {
      const text = z.string().safeParse(event.data);
      if (!text.success) {
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(text.data);
      } catch {
        return;
      }
      const parsed = voiceStreamDownMessageSchema.safeParse(decoded);
      if (!parsed.success) {
        return;
      }
      const down = parsed.data;
      switch (down.type) {
        case "partial":
          // Once the user has released, the final is authoritative and any
          // partial still in flight is stale — dropping it keeps a late one
          // from reappearing after the preview was cleared.
          if (!this.#settled && !this.#finalizing) {
            this.#handlers.onPartial(down.text);
          }
          break;
        case "final":
          this.#settle(() => this.#handlers.onFinal(down.text));
          break;
        case "error":
          this.#settle(() => this.#handlers.onError(down.message));
          break;
      }
    };
    socket.onClose = () => {
      // A close with no final and no cancel is a dropped connection.
      if (!this.#settled && !this.#cancelled) {
        this.#settle(() => this.#handlers.onError("The dictation connection closed."));
      }
    };
    socket.onError = () => {
      if (!this.#settled && !this.#cancelled) {
        this.#settle(() => this.#handlers.onError("The dictation connection failed."));
      }
    };
  }

  /** A PCM16 chunk (Int16 LE, mono, 16 kHz). Queued until the socket opens. */
  pushPcm(pcm: ArrayBuffer): void {
    if (this.#settled || this.#cancelled) {
      return;
    }
    if (this.#socket !== null && this.#open) {
      this.#socket.send(pcm);
    } else {
      this.#pending.push(pcm);
    }
  }

  /** The user released: ask the server for the final over everything fed. From
   *  here on, partials are dropped — the final is what lands. */
  finalize(): void {
    if (this.#settled || this.#cancelled) {
      return;
    }
    this.#finalizing = true;
    if (this.#socket !== null && this.#open) {
      this.#socket.send(JSON.stringify({ type: "finalize" }));
    } else {
      this.#finalizeRequested = true;
    }
  }

  /** Abandon: close the socket, deliver nothing, insert nothing. */
  cancel(): void {
    if (this.#cancelled || this.#settled) {
      this.#teardown();
      return;
    }
    this.#cancelled = true;
    this.#teardown();
  }

  #settle(deliver: () => void): void {
    if (this.#settled) {
      return;
    }
    this.#settled = true;
    deliver();
    this.#teardown();
  }

  #teardown(): void {
    const socket = this.#socket;
    if (socket === null) {
      return;
    }
    this.#socket = null;
    this.#open = false;
    socket.onOpen = null;
    socket.onMessage = null;
    socket.onClose = null;
    socket.onError = null;
    socket.close();
  }
}

export function voiceStreamUrl(origin: string): string {
  return `${origin.replace(/^http/u, "ws")}${VOICE_STREAM_PATH}`;
}

/** The browser boundary: adapts a real WebSocket to `DictationSocket`, with a
 *  binary type so a `final`/`partial` text frame arrives as a string. */
export function browserDictationSocket(url: string): DictationSocket {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const adapter: DictationSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  ws.addEventListener("open", () => adapter.onOpen?.());
  ws.addEventListener("message", (event) => adapter.onMessage?.({ data: event.data }));
  ws.addEventListener("close", () => adapter.onClose?.());
  ws.addEventListener("error", () => adapter.onError?.());
  return adapter;
}
