// A finalize that races the open is held behind the queued frames, so the
// server sees every frame before it is asked for the final.

import { voiceStreamDownMessageSchema } from "@repo/api/local/voice/voice-schema";
import { z } from "zod";

export interface DictationSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  onOpen: (() => void) | null;
  onMessage: ((event: { data: unknown }) => void) | null;
  onClose: (() => void) | null;
  onError: (() => void) | null;
}

export interface DictationStreamHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
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
          // A partial in flight at finalize is stale and would reappear after
          // the preview was cleared.
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
