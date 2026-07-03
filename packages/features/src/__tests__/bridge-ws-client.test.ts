import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BINARY_TAG_STT_PCM, BINARY_TAG_TTS_PCM } from "../bridge-wire";
import { createWsBridge, type WsBridgeConnectionState } from "../bridge-ws-client";

type Listener = (event: { data?: unknown }) => void;

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  url: string;
  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: unknown[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open", {});
  }

  message(data: unknown): void {
    this.emit("message", { data });
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", {});
  }

  sentJson(): Array<Record<string, unknown>> {
    return this.sent
      .filter((f): f is string => typeof f === "string")
      .map((f) => JSON.parse(f) as Record<string, unknown>);
  }
}

function lastSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error("no socket created");
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createWsBridge", () => {
  it("sends a req envelope and resolves with the res result", async () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    socket.open();

    const promise = bridge.readVaultDoc({ path: "a.md" });
    expect(socket.sentJson()).toEqual([
      { t: "req", id: 1, method: "readVaultDoc", payload: { path: "a.md" } },
    ]);

    socket.message(JSON.stringify({ t: "res", id: 1, ok: true, result: "# hi" }));
    await expect(promise).resolves.toBe("# hi");
  });

  it("rejects on an error response", async () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    socket.open();

    const promise = bridge.getVaultRoot();
    socket.message(JSON.stringify({ t: "res", id: 1, ok: false, error: "boom" }));
    await expect(promise).rejects.toThrow("boom");
  });

  it("queues requests made while the socket is connecting", async () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();

    const promise = bridge.getVaultRoot();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sentJson()).toEqual([{ t: "req", id: 1, method: "getVaultRoot" }]);
    socket.message(JSON.stringify({ t: "res", id: 1, ok: true, result: "/v" }));
    await expect(promise).resolves.toBe("/v");
  });

  it("dispatches evt envelopes to subscribers, with unsubscribe", () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    socket.open();

    const seen: Array<{ root: string }> = [];
    const unsubscribe = bridge.onVaultChanged((event) => seen.push(event));
    socket.message(JSON.stringify({ t: "evt", method: "onVaultChanged", payload: { root: "/v" } }));
    expect(seen).toEqual([{ root: "/v" }]);

    unsubscribe();
    socket.message(JSON.stringify({ t: "evt", method: "onVaultChanged", payload: { root: "/w" } }));
    expect(seen).toEqual([{ root: "/v" }]);
  });

  it("routes tagged TTS binary frames to onTtsAudio", () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    socket.open();

    const audio: ArrayBuffer[] = [];
    bridge.onTtsAudio((event) => audio.push(event.audio));

    const pcm = new Int16Array([1000, -2000]);
    const frame = new Uint8Array(1 + pcm.byteLength);
    frame[0] = BINARY_TAG_TTS_PCM;
    frame.set(new Uint8Array(pcm.buffer), 1);
    socket.message(frame.buffer);

    expect(audio).toHaveLength(1);
    const first = audio[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect([...new Int16Array(first)]).toEqual([1000, -2000]);
  });

  it("sends STT PCM as a tagged binary frame, honoring typed-array views", () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    socket.open();

    const backing = new Float32Array([9, 0.5, -0.5, 9]);
    bridge.sendSttAudio(backing.subarray(1, 3));

    const frame = socket.sent.at(-1);
    expect(frame).toBeInstanceOf(ArrayBuffer);
    if (!(frame instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(frame);
    expect(bytes[0]).toBe(BINARY_TAG_STT_PCM);
    const samples = new Float32Array(new Uint8Array(bytes.subarray(1)).buffer);
    expect([...samples]).toEqual([0.5, -0.5]);
  });

  it("drops STT audio while disconnected (stale realtime data)", () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    bridge.sendSttAudio(new Float32Array([1]));
    expect(socket.sent).toHaveLength(0);
  });

  it("rejects in-flight requests on close, fails fast while down, reconnects and resyncs", async () => {
    const states: WsBridgeConnectionState[] = [];
    const bridge = createWsBridge("ws://test/bridge", {
      onConnectionState: (state) => states.push(state),
    });
    const first = lastSocket();
    first.open();

    const inflight = bridge.getVaultRoot();
    first.close();
    await expect(inflight).rejects.toThrow("connection lost");
    expect(states).toEqual(["connecting", "open", "reconnecting"]);

    // Fully down (between retries): fail fast instead of queueing forever.
    await expect(bridge.getAppState()).rejects.toThrow("connection lost");

    // Backoff elapses → a fresh socket; on open the bridge resyncs by
    // re-requesting vault root + app state and re-emitting the events.
    vi.advanceTimersByTime(500);
    const second = lastSocket();
    expect(second).not.toBe(first);

    const roots: string[] = [];
    bridge.onVaultChanged(({ root }) => roots.push(root));
    second.open();
    const methods = second.sentJson().map((f) => f["method"]);
    expect(methods).toContain("getVaultRoot");
    expect(methods).toContain("getAppState");

    const rootReq = second.sentJson().find((f) => f["method"] === "getVaultRoot");
    second.message(JSON.stringify({ t: "res", id: rootReq?.["id"], ok: true, result: "/v2" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(roots).toEqual(["/v2"]);
  });

  it("answers the update trio locally without wire traffic", async () => {
    const bridge = createWsBridge("ws://test/bridge");
    const socket = lastSocket();
    socket.open();

    await expect(bridge.checkForUpdates()).resolves.toMatchObject({ status: "not-available" });
    await expect(bridge.downloadUpdate()).resolves.toMatchObject({ accepted: false });
    await expect(bridge.installUpdate()).resolves.toMatchObject({ accepted: false });
    expect(socket.sent).toHaveLength(0);
  });
});
