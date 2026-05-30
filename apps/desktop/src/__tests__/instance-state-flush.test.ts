import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
}));

import { flushInstanceState, registerInstanceFlush } from "@/renderer/shell/instance-state-flush";
import { flushRendererInstance } from "@/main/lib/widget-flush";

function missingFlushResolver(): void {
  throw new Error("flush resolver missing");
}

describe("instance-state-flush", () => {
  it("flushInstanceState resolves immediately when no viewer is registered", async () => {
    await expect(flushInstanceState("nope")).resolves.toBeUndefined();
  });

  it("flushInstanceState awaits the registered flush before resolving", async () => {
    let resolveFlush = missingFlushResolver;
    const flushed = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveFlush = r;
        }),
    );
    const unregister = registerInstanceFlush("a", flushed);

    let done = false;
    const pending = flushInstanceState("a").then(() => {
      done = true;
      return undefined;
    });
    await Promise.resolve();
    expect(flushed).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    resolveFlush();
    await pending;
    expect(done).toBe(true);
    unregister();
  });

  it("the most-recently-registered flush wins (one viewer per instance)", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const unregister1 = registerInstanceFlush("b", first);
    const unregister2 = registerInstanceFlush("b", second);
    await flushInstanceState("b");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unregister1();
    unregister2();
  });

  it("unregistering only clears the entry when it still owns the slot", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const unregister1 = registerInstanceFlush("c", first);
    registerInstanceFlush("c", second);
    // First viewer unmounts after second already replaced it — should be a no-op.
    unregister1();
    await flushInstanceState("c");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("flushRendererInstance (main → renderer round-trip)", () => {
  it("resolves immediately when no renderer window is alive", async () => {
    // The electron mock above returns an empty window list, so this exercises
    // the no-renderer fallback path used in headless environments and tests.
    const start = Date.now();
    await flushRendererInstance("any-id", 1000);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
