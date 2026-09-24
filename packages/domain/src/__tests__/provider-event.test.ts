import { describe, expect, it } from "vitest";
import {
  getThreadEventItemRef,
  isThreadEventDelta,
  mergeAdjacentDeltas,
  settledReasoningText,
  threadEventSchema,
} from "../provider-event";
import type { DeltaRunLimit, ThreadEvent, ThreadEventItem } from "../provider-event";
import { threadScope, turnScope } from "../thread-event-scope";
import { MAX_THREAD_TITLE_LENGTH } from "../thread-title";

describe("threadEventSchema scope validation", () => {
  it("refuses a turn-only event under thread scope at parse", () => {
    const result = threadEventSchema.safeParse({
      scope: threadScope(),
      threadId: "thr_1",
      type: "turn/started",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["scope", "kind"]);
    }
  });

  it("refuses a turn-scoped frame with no turnId at parse", () => {
    const result = threadEventSchema.safeParse({
      delta: "hi",
      itemId: "item_1",
      scope: { kind: "turn" },
      threadId: "thr_1",
      type: "item/agentMessage/delta",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a thread-only event under turn scope", () => {
    const result = threadEventSchema.safeParse({
      scope: turnScope("turn_1"),
      text: "hello",
      threadId: "thr_1",
      type: "client/turn/requested",
    });
    expect(result.success).toBe(false);
  });

  it("holds a thread's own facts to thread scope, and a stated title to the create route's bound", () => {
    const meta = { scope: threadScope(), threadId: "thr_1", title: "Plan", type: "thread/meta" };
    expect(threadEventSchema.safeParse(meta).success).toBe(true);
    expect(threadEventSchema.safeParse({ ...meta, scope: turnScope("turn_1") }).success).toBe(
      false,
    );
    expect(
      threadEventSchema.safeParse({ ...meta, title: "x".repeat(MAX_THREAD_TITLE_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      threadEventSchema.safeParse({
        scope: turnScope("turn_1"),
        threadId: "thr_1",
        type: "thread/archived",
      }).success,
    ).toBe(false);
  });

  it("accepts provider/error under either scope", () => {
    for (const scope of [threadScope(), turnScope("turn_1")]) {
      const result = threadEventSchema.safeParse({
        message: "boom",
        scope,
        threadId: "thr_1",
        type: "provider/error",
      });
      expect(result.success).toBe(true);
    }
  });

  it("round-trips a streamed item event", () => {
    const event = threadEventSchema.parse({
      item: { id: "item_1", text: "done", type: "agentMessage" },
      scope: turnScope("turn_1"),
      threadId: "thr_1",
      type: "item/completed",
    });
    expect(event.type).toBe("item/completed");
    expect(getThreadEventItemRef(event)).toEqual({
      itemId: "item_1",
      itemKind: "agentMessage",
    });
  });

  it("derives item refs for deltas without inventing a kind", () => {
    const event = threadEventSchema.parse({
      delta: "chunk",
      itemId: "item_1",
      scope: turnScope("turn_1"),
      threadId: "thr_1",
      type: "item/agentMessage/delta",
    });
    expect(getThreadEventItemRef(event)).toEqual({ itemId: "item_1", itemKind: null });
  });
});

const message = (delta: string, itemId = "item_a", turnId = "turn_1"): ThreadEvent => ({
  delta,
  itemId,
  scope: turnScope(turnId),
  threadId: "thr_1",
  type: "item/agentMessage/delta",
});

const output = (delta: string): ThreadEvent => ({
  delta,
  itemId: "item_c",
  scope: turnScope("turn_1"),
  threadId: "thr_1",
  type: "item/commandExecution/outputDelta",
});

const resetOutput = (delta: string): ThreadEvent => ({
  delta,
  itemId: "item_c",
  reset: true,
  scope: turnScope("turn_1"),
  threadId: "thr_1",
  type: "item/commandExecution/outputDelta",
});

const deltasOf = (events: readonly ThreadEvent[]): string[] =>
  events.map((event) => (isThreadEventDelta(event) ? event.delta : event.type));

const jsonBytes = (value: ThreadEvent | string): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const unbounded: DeltaRunLimit = { jsonBytes, maxBytes: Number.POSITIVE_INFINITY };

describe("mergeAdjacentDeltas", () => {
  it("stores a run of one item's deltas as one event carrying their concatenation", () => {
    const merged = mergeAdjacentDeltas(
      [message("Two "), message("commits "), message("landed")],
      unbounded,
    );
    expect(merged).toEqual([message("Two commits landed")]);
  });

  it("never joins across a boundary, another item, another turn or another delta type", () => {
    const completed: ThreadEvent = {
      item: { id: "item_a", text: "a", type: "agentMessage" },
      scope: turnScope("turn_1"),
      threadId: "thr_1",
      type: "item/completed",
    };
    const reasoning: ThreadEvent = {
      delta: "r",
      itemId: "item_a",
      scope: turnScope("turn_1"),
      threadId: "thr_1",
      type: "item/reasoning/textDelta",
    };
    const events = [
      message("a"),
      completed,
      message("b"),
      message("x", "item_b"),
      message("c"),
      message("d", "item_a", "turn_2"),
      reasoning,
      message("e"),
    ];
    expect(mergeAdjacentDeltas(events, unbounded)).toEqual(events);
  });

  it("opens a new run at a reset, which the appends after it join", () => {
    const merged = mergeAdjacentDeltas(
      [output("one "), output("two "), resetOutput("fresh "), output("tail")],
      unbounded,
    );
    expect(merged).toEqual([output("one two "), resetOutput("fresh tail")]);
  });

  it("starts the next run where a join would pass the limit", () => {
    const merged = mergeAdjacentDeltas(
      [message("aa"), message("bb"), message("cc"), message("dd"), message("e")],
      { jsonBytes, maxBytes: jsonBytes(message("")) + 4 },
    );
    expect(deltasOf(merged)).toEqual(["aabb", "ccdd", "e"]);
  });

  it("keeps every row inside the limit when deltas split characters and need escapes", () => {
    const pieces = ["\uD83D", "\uDE00", "\n", '"', "あ", "\u0001"];
    const events = Array.from({ length: 400 }, (_, index) =>
      message(pieces[index % pieces.length] ?? ""),
    );
    const limit = { jsonBytes, maxBytes: jsonBytes(message("")) + 97 };
    const merged = mergeAdjacentDeltas(events, limit);
    expect(merged.length).toBeGreaterThan(1);
    for (const event of merged) {
      expect(jsonBytes(event)).toBeLessThanOrEqual(limit.maxBytes);
    }
    expect(deltasOf(merged).join("")).toBe(deltasOf(events).join(""));
  });
});

const reasoning = (
  summary: string[],
  content: string[],
): Extract<ThreadEventItem, { type: "reasoning" }> => ({
  content,
  id: "item_r",
  summary,
  type: "reasoning",
});

describe("settledReasoningText", () => {
  it("reads the visible summary, else the raw content, one paragraph per part", () => {
    expect(settledReasoningText(reasoning(["first", "second"], ["raw"]))).toBe("first\n\nsecond");
    expect(settledReasoningText(reasoning([], ["raw", "more"]))).toBe("raw\n\nmore");
    expect(settledReasoningText(reasoning([], []))).toBe("");
  });
});
