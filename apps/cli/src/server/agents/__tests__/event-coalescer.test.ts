import { setImmediate as tick } from "node:timers/promises";
import { utf8ByteLength } from "@repo/api/cloud/bytes";
import { EVENT_MAX_BYTES } from "@repo/api/cloud/sync/sync-schema";
import { buildThreadTimeline } from "@repo/api/local/build-thread-timeline";
import type { ThreadEvent, ThreadEventItem } from "@repo/domain/provider-event";
import { isThreadEventDelta } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it, vi } from "vitest";
import { ProviderEventCoalescer } from "../event-coalescer";

const scope = turnScope("turn_1");

const delta = (threadId: string, n: number): ThreadEvent => ({
  delta: `d${n}`,
  itemId: "item_1",
  scope,
  threadId,
  type: "item/agentMessage/delta",
});

const completed = (threadId: string): ThreadEvent => ({
  item: { id: "item_1", text: "done", type: "agentMessage" },
  scope,
  threadId,
  type: "item/completed",
});

const output = (text: string): ThreadEvent => ({
  delta: text,
  itemId: "item_c",
  scope,
  threadId: "thr_1",
  type: "item/commandExecution/outputDelta",
});

const deltaText = (events: readonly ThreadEvent[]): string =>
  events.map((event) => (isThreadEventDelta(event) ? event.delta : "")).join("");

const collect = () => {
  const ingested: ThreadEvent[] = [];
  const coalescer = new ProviderEventCoalescer((_threadId, batch) => {
    ingested.push(...batch);
  });
  return { coalescer, ingested };
};

describe("ProviderEventCoalescer", () => {
  it("a burst of N deltas for one item ingests as ONE row carrying their concatenation", async () => {
    const ingest = vi.fn<(threadId: string, events: readonly ThreadEvent[]) => void>();
    const coalescer = new ProviderEventCoalescer(ingest);
    const deltas = Array.from({ length: 25 }, (_, n) => delta("thr_1", n));
    for (const event of deltas) {
      coalescer.push("thr_1", event);
    }
    expect(ingest).not.toHaveBeenCalled();
    await tick();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith("thr_1", [
      { ...delta("thr_1", 0), delta: deltas.map((_, n) => `d${n}`).join("") },
    ]);
  });

  it("a non-delta event flushes the thread immediately, deltas first, in order", async () => {
    const ingest = vi.fn<(threadId: string, events: readonly ThreadEvent[]) => void>();
    const coalescer = new ProviderEventCoalescer(ingest);
    const done = completed("thr_1");
    for (const event of [delta("thr_1", 1), delta("thr_1", 2), done]) {
      coalescer.push("thr_1", event);
    }
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith("thr_1", [{ ...delta("thr_1", 1), delta: "d1d2" }, done]);
    // The still-scheduled tick finds nothing left and ingests nothing more.
    await tick();
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("flush(threadId) drains only that thread; the tick carries the rest", async () => {
    const ingest = vi.fn<(threadId: string, events: readonly ThreadEvent[]) => void>();
    const coalescer = new ProviderEventCoalescer(ingest);
    const one = delta("thr_1", 1);
    const two = delta("thr_2", 2);
    for (const [threadId, event] of [
      ["thr_1", one],
      ["thr_2", two],
    ] as const) {
      coalescer.push(threadId, event);
    }
    coalescer.flush("thr_1");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith("thr_1", [one]);
    await tick();
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest).toHaveBeenLastCalledWith("thr_2", [two]);
  });

  it("honours a reset: the output before it and the output from it are two rows", async () => {
    const { coalescer, ingested } = collect();
    for (const event of [
      output("stale "),
      output("line"),
      { ...output("fresh "), reset: true },
      output("line"),
    ]) {
      coalescer.push("thr_1", event);
    }
    await tick();
    expect(ingested).toEqual([output("stale line"), { ...output("fresh line"), reset: true }]);
  });

  it("splits a run before a merged row would outgrow what the outbox can sync whole", async () => {
    const { coalescer, ingested } = collect();
    const chunks = Array.from({ length: 100 }, (_, n) => ({
      ...delta("thr_1", n),
      delta: `${n}`.padEnd(1000, "·"),
    }));
    for (const event of chunks) {
      coalescer.push("thr_1", event);
    }
    await tick();
    expect(ingested.length).toBeGreaterThan(1);
    expect(ingested.length).toBeLessThan(10);
    for (const event of ingested) {
      expect(utf8ByteLength(JSON.stringify(event))).toBeLessThanOrEqual(EVENT_MAX_BYTES);
    }
    expect(deltaText(ingested)).toBe(deltaText(chunks));
  });
});

// mulberry32, seeded so a failing stream reproduces.
const makeRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    /* oxlint-disable no-bitwise, unicorn/prefer-math-trunc -- mulberry32 is int32 bit math; Math.trunc drops the wrap */
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    /* oxlint-enable no-bitwise, unicorn/prefer-math-trunc */
  };
};

const pick = <T>(random: () => number, values: readonly T[]): T => {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) {
    throw new Error("pick from empty array");
  }
  return value;
};

const THREAD_ID = "thr_fold";
const STREAM_KINDS = ["agentMessage", "plan", "reasoning", "command"] as const;
type StreamKind = (typeof STREAM_KINDS)[number];
const CHUNKS = ["a", "bc", "de f", "\n", "é", "😀"];

interface OpenItem {
  id: string;
  kind: StreamKind;
}

const startedItem = (item: OpenItem): ThreadEventItem => {
  switch (item.kind) {
    case "agentMessage": {
      return { id: item.id, text: "", type: "agentMessage" };
    }
    case "plan": {
      return { id: item.id, text: "", type: "plan" };
    }
    case "reasoning": {
      return { content: [], id: item.id, summary: [], type: "reasoning" };
    }
    case "command": {
      return {
        approvalStatus: null,
        command: "ls",
        cwd: "/vault",
        id: item.id,
        status: "pending",
        type: "commandExecution",
      };
    }
    // no default
  }
};

// settled with no text of their own where the grammar allows it, so the folded buffer is what shows.
const completedItem = (item: OpenItem): ThreadEventItem => {
  switch (item.kind) {
    case "agentMessage": {
      return { id: item.id, text: "final", type: "agentMessage" };
    }
    case "plan": {
      return { id: item.id, text: "final plan", type: "plan" };
    }
    case "reasoning": {
      return { content: [], id: item.id, summary: [], type: "reasoning" };
    }
    case "command": {
      return {
        approvalStatus: null,
        command: "ls",
        cwd: "/vault",
        exitCode: 0,
        id: item.id,
        status: "completed",
        type: "commandExecution",
      };
    }
    // no default
  }
};

const streamedDelta = (
  random: () => number,
  item: OpenItem,
  itemScope: ThreadEventScope,
): ThreadEvent => {
  const base = {
    delta: pick(random, CHUNKS),
    itemId: item.id,
    scope: itemScope,
    threadId: THREAD_ID,
  };
  switch (item.kind) {
    case "agentMessage": {
      return { ...base, type: "item/agentMessage/delta" };
    }
    case "plan": {
      return { ...base, type: "item/plan/delta" };
    }
    case "reasoning": {
      return random() < 0.5
        ? { ...base, type: "item/reasoning/summaryTextDelta" }
        : { ...base, type: "item/reasoning/textDelta" };
    }
    case "command": {
      return random() < 0.15
        ? { ...base, reset: true, type: "item/commandExecution/outputDelta" }
        : { ...base, type: "item/commandExecution/outputDelta" };
    }
    // no default
  }
};

const randomStream = (random: () => number): ThreadEvent[] => {
  const events: ThreadEvent[] = [];
  for (const turnId of ["turn_a", "turn_b"]) {
    const itemScope = turnScope(turnId);
    events.push({ scope: itemScope, threadId: THREAD_ID, type: "turn/started" });
    const open: OpenItem[] = [];
    for (let step = 0; step < 40; step += 1) {
      const roll = random();
      if (open.length === 0 || roll < 0.1) {
        const item = { id: `item_${turnId}_${step}`, kind: pick(random, STREAM_KINDS) };
        open.push(item);
        events.push({
          item: startedItem(item),
          scope: itemScope,
          threadId: THREAD_ID,
          type: "item/started",
        });
      } else if (roll < 0.8) {
        events.push(streamedDelta(random, pick(random, open), itemScope));
      } else if (roll < 0.9) {
        const item = pick(random, open);
        open.splice(open.indexOf(item), 1);
        events.push({
          item: completedItem(item),
          scope: itemScope,
          threadId: THREAD_ID,
          type: "item/completed",
        });
      } else {
        events.push({
          message: "hiccup",
          scope: itemScope,
          threadId: THREAD_ID,
          type: "provider/error",
        });
      }
    }
    if (random() < 0.5) {
      events.push({
        scope: itemScope,
        status: "completed",
        threadId: THREAD_ID,
        type: "turn/completed",
      });
    }
  }
  return events;
};

// where an event landed moves with the merge; what the rows say must not.
const LANDING_KEYS = new Set(["completedAt", "createdAt", "sourceSeqEnd", "sourceSeqStart"]);

const foldedRows = (events: readonly ThreadEvent[]): string =>
  JSON.stringify(
    buildThreadTimeline(
      events.map((event, index) => ({ createdAt: index, event, sequence: index + 1 })),
    ).rows,
    (key, value) => {
      if (LANDING_KEYS.has(key)) {
        return null;
      }
      return key === "id" ? String(value).replace(/^error:\d+$/u, "error") : value;
    },
    2,
  );

describe("the coalescer's merge, folded", () => {
  it("folds every random stream to the rows its unmerged events fold to", async () => {
    let merged = 0;
    for (let run = 1; run <= 150; run += 1) {
      const random = makeRandom(run);
      const pushed = randomStream(random);
      const { coalescer, ingested } = collect();
      for (const event of pushed) {
        coalescer.push(THREAD_ID, event);
        if (random() < 0.1) {
          await tick();
        }
      }
      await tick();
      expect(foldedRows(ingested), `seed ${run}`).toBe(foldedRows(pushed));
      merged += pushed.length - ingested.length;
    }
    expect(merged).toBeGreaterThan(0);
  });
});
