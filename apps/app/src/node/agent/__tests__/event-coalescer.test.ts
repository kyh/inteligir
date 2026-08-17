import { setImmediate as tick } from "node:timers/promises";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it, vi } from "vitest";
import { ProviderEventCoalescer } from "../event-coalescer";

const scope = turnScope("turn_1");

function delta(threadId: string, n: number): ThreadEvent {
  return {
    type: "item/agentMessage/delta",
    threadId,
    itemId: "item_1",
    delta: `d${n}`,
    scope,
  };
}

function completed(threadId: string): ThreadEvent {
  return {
    type: "item/completed",
    threadId,
    item: { type: "agentMessage", id: "item_1", text: "done" },
    scope,
  };
}

describe("ProviderEventCoalescer", () => {
  it("a burst of N deltas produces ONE ingest call carrying all of them in order", async () => {
    const ingest = vi.fn<(threadId: string, events: readonly ThreadEvent[]) => void>();
    const coalescer = new ProviderEventCoalescer(ingest);
    const deltas = Array.from({ length: 25 }, (_, n) => delta("thr_1", n));
    for (const event of deltas) {
      coalescer.push("thr_1", event);
    }
    expect(ingest).not.toHaveBeenCalled();
    await tick();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith("thr_1", deltas);
  });

  it("a non-delta event flushes the thread immediately, deltas first, in order", async () => {
    const ingest = vi.fn<(threadId: string, events: readonly ThreadEvent[]) => void>();
    const coalescer = new ProviderEventCoalescer(ingest);
    const a = delta("thr_1", 1);
    const b = delta("thr_1", 2);
    const done = completed("thr_1");
    coalescer.push("thr_1", a);
    coalescer.push("thr_1", b);
    coalescer.push("thr_1", done);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith("thr_1", [a, b, done]);
    // The still-scheduled tick finds nothing left and ingests nothing more.
    await tick();
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("flush(threadId) drains only that thread; the tick carries the rest", async () => {
    const ingest = vi.fn<(threadId: string, events: readonly ThreadEvent[]) => void>();
    const coalescer = new ProviderEventCoalescer(ingest);
    const one = delta("thr_1", 1);
    const two = delta("thr_2", 2);
    coalescer.push("thr_1", one);
    coalescer.push("thr_2", two);
    coalescer.flush("thr_1");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith("thr_1", [one]);
    await tick();
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest).toHaveBeenLastCalledWith("thr_2", [two]);
  });
});
