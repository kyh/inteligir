// ---------------------------------------------------------------------------
// Change-stream reconnect supervision. The SSE stream is long-lived and dies on
// any network blip; without a supervisor that re-subscribes, one drop silently
// demotes the client to whatever else happens to call scheduleSync (the
// coordinator's 5-minute timer, window focus) for the engine's lifetime.
//
// Driven through a port whose subscribe/onEnd is controlled by hand — no
// network, no real timers.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryBaseStore } from "../base-store";
import { InMemoryBaseBlobStore } from "../blob-store";
import { SyncEngine, type Clock } from "../engine";
import { InMemorySyncPort, MemoryVault, webCryptoHasher } from "./in-memory-sync-port";
import type { Unsubscribe, VaultChange } from "../sync-port";

const fixedStamp: Clock = () => "2026-07-05T12-34-56-000Z";

/** A real SyncPort whose change stream the test can drop on demand — extends
 * the in-memory port so it satisfies the whole contract honestly rather than
 * being asserted into shape. */
class FlakyPort extends InMemorySyncPort {
  subscribeCount = 0;
  unsubscribeCount = 0;
  private onChange: ((change: VaultChange) => void) | null = null;
  private onEnd: (() => void) | null = null;

  override subscribe(onChange: (change: VaultChange) => void, onEnd?: () => void): Unsubscribe {
    this.subscribeCount += 1;
    this.onChange = onChange;
    this.onEnd = onEnd ?? null;
    return () => {
      this.unsubscribeCount += 1;
      this.onChange = null;
      this.onEnd = null;
    };
  }

  /** The connection died on its own (drop / server close). */
  dropStream(): void {
    const end = this.onEnd;
    this.onChange = null;
    this.onEnd = null;
    end?.();
  }

  /** A peer committed something on the live stream. */
  pushChange(): void {
    this.onChange?.({ kind: "deleted", path: "peer.md" });
  }

  get live(): boolean {
    return this.onChange !== null;
  }
}

let port: FlakyPort;
let engine: SyncEngine;

beforeEach(() => {
  vi.useFakeTimers();
  port = new FlakyPort("vault-1");
  const vault = new MemoryVault();
  engine = new SyncEngine({
    vaultId: "vault-1",
    // Only subscribe() is reached: the debounce is parked so no pass runs.
    port,
    io: vault.io,
    base: new InMemoryBaseStore(),
    blobs: new InMemoryBaseBlobStore(),
    hash: webCryptoHasher(),
    stamp: fixedStamp,
    debounceMs: 10_000_000, // park the debounce; this test is about the stream
  });
});

afterEach(() => {
  engine.stop();
  vi.useRealTimers();
});

describe("change-stream supervision", () => {
  it("reopens the stream after a drop", () => {
    engine.start();
    expect(port.subscribeCount).toBe(1);

    port.dropStream();
    expect(port.live).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(port.subscribeCount).toBe(2);
    expect(port.live).toBe(true);
  });

  it("backs off exponentially across consecutive drops, capped at 30s", () => {
    engine.start();
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

    delays.forEach((delay, i) => {
      port.dropStream();
      // Not yet — one tick short of the expected delay.
      vi.advanceTimersByTime(delay - 1);
      expect(port.subscribeCount).toBe(i + 1);
      vi.advanceTimersByTime(1);
      expect(port.subscribeCount).toBe(i + 2);
    });
  });

  it("resets the backoff once a change proves the stream works", () => {
    engine.start();
    for (let i = 0; i < 3; i += 1) {
      port.dropStream();
      vi.advanceTimersByTime(30_000);
    }
    expect(port.subscribeCount).toBe(4);

    port.pushChange();
    port.dropStream();
    // Back to the base delay, not the escalated one.
    vi.advanceTimersByTime(1_000);
    expect(port.subscribeCount).toBe(5);
  });

  it("never reconnects after an explicit stop()", () => {
    engine.start();
    engine.stop();
    expect(port.unsubscribeCount).toBe(1);

    vi.advanceTimersByTime(120_000);
    expect(port.subscribeCount).toBe(1);
  });

  it("cancels a pending reconnect on stop()", () => {
    engine.start();
    port.dropStream();
    engine.stop();

    vi.advanceTimersByTime(120_000);
    expect(port.subscribeCount).toBe(1);
    expect(port.live).toBe(false);
  });

  it("is idempotent while a reconnect is pending", () => {
    engine.start();
    port.dropStream();
    engine.start(); // must not open a second stream alongside the pending retry
    vi.advanceTimersByTime(1_000);
    expect(port.subscribeCount).toBe(2);
  });
});
