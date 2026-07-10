import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeFrame, parseClientFrame } from "@repo/features/ws-protocol";
import { parsePairingInput, pairWithHost } from "../pairing";
import { FakeSocket, fakeWebSocketImpl, lastSocket, memEnvironmentStore } from "./fakes";

// A realistic pairing code: 32 bytes base64url'd = 43 chars.
const CODE = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

describe("pairWithHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function begin(overrides?: { pairingToken?: string }) {
    const { impl, sockets } = fakeWebSocketImpl();
    const { store } = memEnvironmentStore();
    const result = pairWithHost({
      wsUrl: " ws://192.168.1.5:47890 ",
      pairingToken: overrides?.pairingToken ?? CODE,
      deviceName: "Kyh's Phone",
      store,
      webSocketImpl: impl,
    });
    return { sockets, store, result };
  }

  it("sends the pair frame on open and persists + resolves on paired", async () => {
    const { sockets, store, result } = begin();
    const socket = lastSocket(sockets);
    expect(socket.url).toBe("ws://192.168.1.5:47890");

    socket.fireOpen();
    expect(socket.sent).toHaveLength(1);
    const sent = socket.sent[0];
    const frame = typeof sent === "string" ? parseClientFrame(sent) : null;
    expect(frame).toEqual({ t: "pair", pairingToken: CODE, deviceName: "Kyh's Phone" });

    socket.fireMessage(encodeFrame({ t: "paired", deviceToken: "durable-token", deviceId: "d1" }));
    await expect(result).resolves.toEqual({
      ok: true,
      env: {
        name: "192.168.1.5",
        wsUrl: "ws://192.168.1.5:47890",
        deviceId: "d1",
        deviceToken: "durable-token",
      },
    });
    expect(store.get()?.deviceToken).toBe("durable-token");
    expect(socket.closedWith?.code).toBe(1000);
  });

  it("maps close 4401 to a rejected-code error and persists nothing", async () => {
    const { sockets, store, result } = begin();
    const socket = lastSocket(sockets);
    socket.fireOpen();
    socket.fireClose(4401);
    await expect(result).resolves.toEqual({
      ok: false,
      error: "Pairing code rejected or expired.",
    });
    expect(store.get()).toBeNull();
  });

  it("maps any other close to a connection error", async () => {
    const { sockets, result } = begin();
    lastSocket(sockets).fireClose(1006);
    const out = await result;
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/could not connect/i);
  });

  it("times out after 15s when the host never answers", async () => {
    const { sockets, store, result } = begin();
    lastSocket(sockets).fireOpen();
    vi.advanceTimersByTime(15_000);
    await expect(result).resolves.toEqual({
      ok: false,
      error: "Timed out connecting to the desktop.",
    });
    expect(store.get()).toBeNull();
  });

  it("ignores non-paired frames and settles only once", async () => {
    const { sockets, result } = begin();
    const socket = lastSocket(sockets);
    socket.fireOpen();
    socket.fireMessage("not json");
    socket.fireMessage(encodeFrame({ t: "welcome" }));
    socket.fireMessage(encodeFrame({ t: "paired", deviceToken: "tok", deviceId: "d1" }));
    socket.fireClose(4401); // late close must not flip the settled result
    const out = await result;
    expect(out.ok).toBe(true);
  });

  it("trims whitespace off the pasted code before presenting it", async () => {
    const { sockets, result } = begin({ pairingToken: `  ${CODE}\n` });
    const socket = lastSocket(sockets);
    socket.fireOpen();
    const sent = socket.sent[0];
    const frame = typeof sent === "string" ? parseClientFrame(sent) : null;
    expect(frame?.t === "pair" && frame.pairingToken).toBe(CODE);
    socket.fireClose(4401);
    await result;
  });

  it("resolves an error (never throws) when the socket cannot be constructed", async () => {
    const { store } = memEnvironmentStore();
    const throwing = class extends FakeSocket {
      constructor(url: string) {
        super(url);
        throw new Error("boom");
      }
    };
    const out = await pairWithHost({
      wsUrl: "ws://bad",
      pairingToken: CODE,
      deviceName: "Phone",
      store,
      webSocketImpl: throwing,
    });
    expect(out).toEqual({ ok: false, error: "Could not connect to ws://bad." });
  });
});

describe("parsePairingInput", () => {
  it("parses the desktop's rendered form: two 'or'-joined LAN urls", () => {
    expect(parsePairingInput("ws://192.168.1.5:47890 or ws://10.0.0.2:47890")).toEqual({
      wsUrl: "ws://192.168.1.5:47890",
      pairingToken: null,
    });
  });

  it("parses a bare pasted code", () => {
    expect(parsePairingInput(`  ${CODE}  `)).toEqual({ wsUrl: null, pairingToken: CODE });
  });

  it("parses url and code pasted together with surrounding prose", () => {
    const text = `On the other device, connect to ws://192.168.1.5:47890 and enter this one-time code: ${CODE}. Single use.`;
    expect(parsePairingInput(text)).toEqual({
      wsUrl: "ws://192.168.1.5:47890",
      pairingToken: CODE,
    });
  });

  it("parses a combined pairing URL with the code in the fragment", () => {
    expect(parsePairingInput(`ws://192.168.1.5:47890#${CODE}`)).toEqual({
      wsUrl: "ws://192.168.1.5:47890",
      pairingToken: CODE,
    });
  });

  it("parses a combined pairing URL with the code in a query param", () => {
    expect(parsePairingInput(`wss://host.local:47890/?token=${CODE}`)).toEqual({
      wsUrl: "wss://host.local:47890",
      pairingToken: CODE,
    });
  });

  it("never scavenges a code from inside the address", () => {
    expect(parsePairingInput("ws://averylonghostnamewithoutdots:47890")).toEqual({
      wsUrl: "ws://averylonghostnamewithoutdots:47890",
      pairingToken: null,
    });
  });

  it("strips trailing punctuation off a url pasted from prose", () => {
    expect(parsePairingInput("connect to ws://192.168.1.5:47890.")).toEqual({
      wsUrl: "ws://192.168.1.5:47890",
      pairingToken: null,
    });
  });

  it("returns nulls for text containing neither", () => {
    expect(parsePairingInput("hello world")).toEqual({ wsUrl: null, pairingToken: null });
  });
});
