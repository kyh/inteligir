import { describe, expect, it } from "vitest";
import { getThreadEventItemRef, settledReasoningText, threadEventSchema } from "../provider-event";
import type { ThreadEventItem } from "../provider-event";
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

  it("keeps a provider/error's failure class, and parses one written before it", () => {
    const base = { message: "boom", scope: turnScope("turn_1"), threadId: "thr_1" };
    expect(
      threadEventSchema.parse({ ...base, failure: "usage-limit", type: "provider/error" }),
    ).toMatchObject({ failure: "usage-limit" });
    expect(threadEventSchema.parse({ ...base, type: "provider/error" })).not.toHaveProperty(
      "failure",
    );
    // a class a later build adds costs the event nothing on this one
    expect(
      threadEventSchema.parse({ ...base, failure: "some-later-class", type: "provider/error" }),
    ).toMatchObject({ failure: null, message: "boom" });
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
