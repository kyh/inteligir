// ---------------------------------------------------------------------------
// The ws Bridge client, driven through its two injected seams.
//
// `webSocketImpl` and `mintTicket` are the whole of what this module touches
// outside itself, so a fake socket plus a fake minter reaches every rule it
// owns: mint-then-dial ordering, `unauthorized` as a terminal state, the
// backoff supervisor, the bounded queue and what overflowing it drops, the
// inflight rejection when a socket goes, binary tag framing, and the fact that
// fire-and-forget frames are DROPPED rather than queued.
//
// Nothing here asserts on the registry's contents: the bridge is a fold over
// it, so the cases pick one channel of each kind and the wire bytes are the
// assertion.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWsBridge, type MintedTicket } from "../ws-bridge";
import {
  WS_CLOSE_UNAUTHORIZED,
  encodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  type ClientFrame,
} from "../ws-protocol";

/** The socket the bridge opens, with the peer's half exposed as methods a case
 * calls: `open`, `welcome`, `deliver`, `serverClose`. */
class FakeSocket {
  binaryType = "";
  readonly sent: Array<string | Uint8Array<ArrayBuffer>> = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(readonly url: string) {}

  send(data: string | Uint8Array<ArrayBuffer>): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) this.listeners.set(type, [listener]);
    else existing.push(listener);
  }

  // ---- the peer -----------------------------------------------------------

  open(): void {
    this.emit("open", { type: "open" });
  }

  welcome(): void {
    this.deliver(encodeFrame({ t: "welcome" }));
  }

  deliver(data: string | ArrayBuffer): void {
    this.emit("message", { type: "message", data });
  }

  serverClose(code: number): void {
    this.emit("close", { type: "close", code });
  }

  /** The client frames this socket was sent, parsed. */
  frames(): ClientFrame[] {
    return this.sent.flatMap((data) => {
      if (typeof data !== "string") return [];
      const frame = parseClientFrame(data);
      return frame === null ? [] : [frame];
    });
  }

  /** The binary frames this socket was sent. */
  binary(): Array<Uint8Array<ArrayBuffer>> {
    return this.sent.filter((data) => typeof data !== "string");
  }

  private emit(type: string, event: FakeEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

type FakeEvent = { data?: unknown; type?: string; code?: number };

/** Fake timers leave microtasks alone, so letting the mint promise (and the
 * request promises behind it) land is draining the queue a few hops. */
const settle = async (): Promise<void> => {
  for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
};

/** Record why a request rejected without leaving an unhandled rejection. */
function rejection(promise: Promise<unknown>): { message: () => string | null } {
  let message: string | null = null;
  void promise.catch((error: unknown) => {
    message = error instanceof Error ? error.message : String(error);
  });
  return { message: () => message };
}

type Harness = {
  bridge: ReturnType<typeof createWsBridge>["bridge"];
  dispose: () => void;
  /** Every socket the bridge has opened, in order. */
  sockets: FakeSocket[];
  /** The socket it most recently opened. */
  socket: () => FakeSocket;
  /** How many tickets have been minted. */
  mints: () => number;
  /** What the next mint answers with. */
  setTicket: (minted: MintedTicket) => void;
  statuses: string[];
};

function harness(options?: {
  /** Hold the first mint open so a case can observe the bridge before it has a
   * ticket. */
  readonly deferMint?: boolean;
  /** What the FIRST mint answers with — the constructor asks for one before a
   * case can call `setTicket`. */
  readonly ticket?: MintedTicket;
}): Harness & {
  resolveMint: (minted: MintedTicket) => Promise<void>;
} {
  const sockets: FakeSocket[] = [];
  class Impl extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  }

  let mints = 0;
  let ticket: MintedTicket = options?.ticket ?? { ok: true, ticket: "ticket-1" };
  let release: ((minted: MintedTicket) => void) | null = null;
  const statuses: string[] = [];

  const { bridge, dispose } = createWsBridge({
    url: "wss://host.example/v1/host/ws",
    webSocketImpl: Impl,
    mintTicket: () => {
      mints += 1;
      if (options?.deferMint !== true) return Promise.resolve(ticket);
      return new Promise<MintedTicket>((resolve) => {
        release = resolve;
      });
    },
    onStatus: (status) => statuses.push(status),
  });

  return {
    bridge,
    dispose,
    sockets,
    socket: () => {
      const latest = sockets.at(-1);
      if (latest === undefined) throw new Error("no socket was opened");
      return latest;
    },
    mints: () => mints,
    setTicket: (next) => {
      ticket = next;
    },
    statuses,
    resolveMint: async (minted) => {
      release?.(minted);
      await settle();
    },
  };
}

/** Get to a welcomed socket, which is where most rules start. */
async function connected(): Promise<Harness> {
  const h = harness();
  await settle();
  h.socket().open();
  h.socket().welcome();
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("mint, then dial", () => {
  it("opens no socket until the ticket is in hand, and presents it as the first frame", async () => {
    const h = harness({ deferMint: true });
    await settle();
    // A socket opened before the ticket exists would sit against the host's
    // auth deadline waiting for one.
    expect(h.sockets).toHaveLength(0);
    expect(h.mints()).toBe(1);

    await h.resolveMint({ ok: true, ticket: "ticket-1" });
    expect(h.sockets).toHaveLength(1);
    // Nothing is sent until the socket is actually open.
    expect(h.socket().sent).toEqual([]);

    h.socket().open();
    expect(h.socket().frames()).toEqual([{ t: "auth", ticket: "ticket-1" }]);
    h.dispose();
  });

  it("mints a FRESH ticket for every attempt — a reconnect cannot replay one", async () => {
    const h = harness();
    await settle();
    h.socket().open();
    h.socket().welcome();
    h.setTicket({ ok: true, ticket: "ticket-2" });

    h.socket().serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    await settle();

    expect(h.mints()).toBe(2);
    expect(h.sockets).toHaveLength(2);
    h.socket().open();
    expect(h.socket().frames()).toEqual([{ t: "auth", ticket: "ticket-2" }]);
    h.dispose();
  });
});

describe("unauthorized is terminal", () => {
  it("stops before dialling when the minter says the session is gone", async () => {
    const h = harness({ ticket: { ok: false, reason: "unauthorized" } });
    await settle();
    expect(h.sockets).toHaveLength(0);
    expect(h.statuses.at(-1)).toBe("unauthorized");

    // No retry, ever: re-presenting a dead credential helps no one.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(h.mints()).toBe(1);

    const refused = rejection(h.bridge.listVault());
    await settle();
    expect(refused.message()).toContain("unauthorized");
    h.dispose();
  });

  it("treats the host's auth close code the same way, and fails everything in flight", async () => {
    const h = await connected();
    const inflight = rejection(h.bridge.readVaultDoc({ path: "notes/a.md" }));
    await settle();

    h.socket().serverClose(WS_CLOSE_UNAUTHORIZED);
    await settle();

    expect(h.statuses.at(-1)).toBe("unauthorized");
    expect(inflight.message()).toContain("unauthorized");
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(h.sockets).toHaveLength(1);
    h.dispose();
  });

  it("keeps retrying when the mint failed on the NETWORK instead", async () => {
    const h = harness({ ticket: { ok: false, reason: "unavailable" } });
    await settle();
    expect(h.sockets).toHaveLength(0);
    expect(h.statuses.at(-1)).toBe("disconnected");

    h.setTicket({ ok: true, ticket: "ticket-2" });
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(h.sockets).toHaveLength(1);
    h.dispose();
  });
});

describe("the reconnect supervisor", () => {
  it("backs off exponentially, and a welcome resets the progression", async () => {
    const h = await connected();

    h.socket().serverClose(1006);
    await vi.advanceTimersByTimeAsync(499);
    await settle();
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(h.sockets).toHaveLength(2);

    // Second failure in a row: double the wait.
    h.socket().serverClose(1006);
    await vi.advanceTimersByTimeAsync(999);
    await settle();
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(h.sockets).toHaveLength(3);

    // A socket that got all the way to welcome starts the progression over.
    h.socket().open();
    h.socket().welcome();
    h.socket().serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(h.sockets).toHaveLength(4);
    h.dispose();
  });

  it("rejects everything awaiting a res frame when the socket goes", async () => {
    const h = await connected();
    const pending = rejection(h.bridge.readVaultDoc({ path: "notes/a.md" }));
    await settle();
    expect(h.socket().frames()).toHaveLength(2); // auth + req

    h.socket().serverClose(1006);
    await settle();
    expect(pending.message()).toContain("connection lost");

    // And it is NOT re-sent on the socket that replaces it: a request the
    // caller was told failed must not land twice.
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    h.socket().open();
    h.socket().welcome();
    expect(h.socket().frames()).toEqual([{ t: "auth", ticket: "ticket-1" }]);
    h.dispose();
  });

  it("keeps event subscriptions across a reconnect", async () => {
    const h = await connected();
    const seen: unknown[] = [];
    h.bridge.onKnowledgeUpdated((event) => seen.push(event));

    h.socket().serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    h.socket().open();
    h.socket().welcome();
    h.socket().deliver(encodeFrame({ t: "evt", method: "onKnowledgeUpdated", payload: {} }));

    expect(seen).toEqual([{}]);
    h.dispose();
  });
});

describe("the request queue", () => {
  it("holds requests made while disconnected and flushes them on welcome, in order", async () => {
    const h = harness();
    await settle();
    h.socket().open();

    const first = h.bridge.readVaultDoc({ path: "notes/a.md" });
    const second = h.bridge.readVaultDoc({ path: "notes/b.md" });
    await settle();
    // Not welcomed yet — nothing but the auth frame has crossed.
    expect(h.socket().frames()).toHaveLength(1);

    h.socket().welcome();
    expect(h.socket().frames().slice(1)).toEqual([
      { t: "req", id: 1, method: "readVaultDoc", payload: { path: "notes/a.md" } },
      { t: "req", id: 2, method: "readVaultDoc", payload: { path: "notes/b.md" } },
    ]);

    h.socket().deliver(encodeFrame({ t: "res", id: 1, ok: true, result: "# A" }));
    h.socket().deliver(encodeFrame({ t: "res", id: 2, ok: false, error: "gone" }));
    await expect(first).resolves.toBe("# A");
    await expect(second).rejects.toThrow("gone");
    h.dispose();
  });

  it("drops the OLDEST request on overflow, and tells its caller so", async () => {
    const h = harness();
    await settle();
    h.socket().open();

    // One past the 256-deep cap: the queue is a bound on memory, and the
    // request most likely to be stale is the one that has waited longest.
    const queued = Array.from({ length: 257 }, () =>
      rejection(h.bridge.readVaultDoc({ path: "notes/a.md" })),
    );
    await settle();

    expect(queued[0]?.message()).toContain("queue overflow");
    expect(queued[1]?.message()).toBeNull();

    h.socket().welcome();
    const flushed = h.socket().frames().slice(1);
    expect(flushed).toHaveLength(256);
    // The survivors are ids 2..257 — the head went, not the tail.
    expect(flushed[0]).toMatchObject({ id: 2 });
    expect(flushed.at(-1)).toMatchObject({ id: 257 });
    h.dispose();
  });

  it("rejects a request made after dispose rather than queueing it forever", async () => {
    const h = await connected();
    h.dispose();
    const refused = rejection(h.bridge.listVault());
    await settle();
    expect(refused.message()).toContain("disposed");
    expect(h.socket().closedWith).toEqual({ code: 1000, reason: "disposed" });
  });
});

describe("fire-and-forget frames", () => {
  it("DROPS a send made while disconnected instead of queueing it", async () => {
    const h = harness();
    await settle();
    h.socket().open();

    // A stale tts control frame delivered to a later socket is worse than one
    // that never arrives.
    h.bridge.ttsFlush(undefined);
    expect(h.socket().frames()).toHaveLength(1);

    h.socket().welcome();
    h.bridge.ttsFlush(undefined);
    expect(h.socket().frames().slice(1)).toEqual([{ t: "send", method: "ttsFlush" }]);
    h.dispose();
  });

  it("frames a binary channel as [tag][bytes], and drops a payload that is not bytes", async () => {
    const h = await connected();

    h.bridge.sendSttAudio(new Float32Array([1, 2]).buffer);
    const [frame] = h.socket().binary();
    expect(frame?.[0]).toBe(1); // sendSttAudio's declared tag
    expect(frame?.byteLength).toBe(1 + 8);

    // The receiving side only decodes bytes for these methods, so anything else
    // is dropped rather than silently JSON-encoded.
    h.bridge.sendSttAudio({ not: "bytes" });
    expect(h.socket().binary()).toHaveLength(1);
    expect(h.socket().frames()).toHaveLength(1); // still just the auth frame
    h.dispose();
  });

  it("reconstitutes an inbound binary event from its tag alone", async () => {
    const h = await connected();
    const heard: ArrayBuffer[] = [];
    h.bridge.onTtsAudio(({ audio }) => heard.push(audio));

    h.socket().deliver(encodeBinaryFrame(2, new Uint8Array([7, 8, 9])).buffer);
    expect(heard).toHaveLength(1);
    expect([...new Uint8Array(heard[0] ?? new ArrayBuffer(0))]).toEqual([7, 8, 9]);

    // A tag this client's registry does not know is dropped, not guessed at.
    h.socket().deliver(encodeBinaryFrame(200, new Uint8Array([1])).buffer);
    expect(heard).toHaveLength(1);
    h.dispose();
  });
});
