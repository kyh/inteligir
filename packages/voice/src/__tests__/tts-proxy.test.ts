// ---------------------------------------------------------------------------
// TTS proxy: the base64 → PCM decode path and the connection lifecycle, driven
// through the injected `openSocket` seam so nothing here touches the network
// or needs an ElevenLabs key.
//
// The decode assertions exist because of a real shipped bug: `Buffer.from(b64,
// "base64")` returns a VIEW into Node's shared allocation pool, so reading
// `.buffer` without honoring byteOffset/byteLength hands out the whole pool.
// Measured on Node 24: BOTH a 64-byte and a 16KB chunk emitted 65,536 bytes —
// so every chunk was pool-sized garbage, not just small ones, and each frame
// carried adjacent heap bytes across to the renderer.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureTts, ttsAvailable, ttsFlush, ttsInterrupt, ttsSend } from "../tts-proxy";

type Listener = (event: { data: unknown }) => void;

/** Minimal stand-in for the upstream ElevenLabs socket. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** Drive a listener the way the real socket would. */
  fire(type: string, event: { data: unknown } = { data: "" }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = 1;
    this.fire("open");
  }

  /** Deliver one audio frame carrying `bytes` as base64. */
  deliverAudio(bytes: Uint8Array): void {
    const audio = Buffer.from(bytes).toString("base64");
    this.fire("message", { data: JSON.stringify({ audio }) });
  }
}

let sockets: FakeSocket[] = [];
let emitted: ArrayBuffer[] = [];

function latest(): FakeSocket {
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error("no socket opened");
  return socket;
}

beforeEach(() => {
  sockets = [];
  emitted = [];
  configureTts({
    getApiKey: () => "test-key",
    emitAudio: (audio) => emitted.push(audio),
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
});

afterEach(() => {
  // Drops pendingText + the module's socket reference, isolating the next test.
  ttsInterrupt();
  configureTts({ getApiKey: () => null, emitAudio: () => {} });
});

describe("audio decode", () => {
  it("emits exactly the chunk's bytes for a short (pooled) frame", () => {
    ttsSend("hello");
    latest().open();
    // 64 bytes — far under Buffer.poolSize>>>1, so Buffer.from returns a view
    // into the shared pool at a non-zero offset.
    const pcm = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 256);
    latest().deliverAudio(pcm);

    expect(emitted).toHaveLength(1);
    const first = emitted[0];
    if (first === undefined) throw new Error("no audio emitted");
    expect(first.byteLength).toBe(64);
    expect(new Uint8Array(first)).toEqual(pcm);
  });

  it("emits exactly the chunk's bytes for a large (unpooled) frame", () => {
    ttsSend("hello");
    latest().open();
    const pcm = Uint8Array.from({ length: 16_384 }, (_, i) => (i * 13) % 256);
    latest().deliverAudio(pcm);

    const first = emitted[0];
    if (first === undefined) throw new Error("no audio emitted");
    expect(first.byteLength).toBe(16_384);
    expect(new Uint8Array(first)).toEqual(pcm);
  });

  it("keeps consecutive short chunks independent", () => {
    ttsSend("hello");
    latest().open();
    const a = Uint8Array.from({ length: 32 }, () => 0xaa);
    const b = Uint8Array.from({ length: 32 }, () => 0xbb);
    latest().deliverAudio(a);
    latest().deliverAudio(b);

    expect(emitted.map((buf) => new Uint8Array(buf))).toEqual([a, b]);
  });

  it("ignores malformed and non-audio frames", () => {
    ttsSend("hello");
    latest().open();
    latest().fire("message", { data: "not json" });
    latest().fire("message", { data: JSON.stringify({ audio: 42 }) });
    latest().fire("message", { data: JSON.stringify({ isFinal: true }) });

    expect(emitted).toEqual([]);
  });
});

describe("connection lifecycle", () => {
  it("buffers text sent before open, then flushes it on open", () => {
    ttsSend("first");
    ttsSend("second");
    const socket = latest();
    expect(socket.sent).toEqual([]);

    socket.open();
    const texts = socket.sent.map((raw) => {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null && "text" in parsed ? parsed.text : null;
    });
    // The handshake frame is a single space, then the buffered text in order.
    expect(texts).toEqual([" ", "first", "second"]);
  });

  it("reuses one socket across sends and opens a fresh one after flush", () => {
    ttsSend("a");
    latest().open();
    ttsSend("b");
    expect(sockets).toHaveLength(1);

    ttsFlush();
    ttsSend("c");
    expect(sockets).toHaveLength(2);
  });

  it("drops the socket and pending text on interrupt", () => {
    ttsSend("queued");
    const socket = latest();
    ttsInterrupt();
    expect(socket.closed).toBe(true);

    // The queued text must not survive onto the next connection.
    ttsSend("fresh");
    latest().open();
    const texts = latest().sent.map((raw) => {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null && "text" in parsed ? parsed.text : null;
    });
    expect(texts).toEqual([" ", "fresh"]);
  });

  it("opens no socket when no key is configured", () => {
    configureTts({ getApiKey: () => null, emitAudio: (audio) => emitted.push(audio) });
    delete process.env["ELEVENLABS_API_KEY"];
    expect(ttsAvailable()).toBe(false);
    ttsSend("hello");
    expect(sockets).toEqual([]);
  });
});
