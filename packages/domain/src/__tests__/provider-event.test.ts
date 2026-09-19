import { describe, expect, it } from "vitest";
import { getThreadEventItemRef, threadEventSchema } from "../provider-event";
import { threadScope, turnScope } from "../thread-event-scope";

describe("threadEventSchema scope validation", () => {
  it("refuses a turn-only event under thread scope at parse", () => {
    const result = threadEventSchema.safeParse({
      scope: threadScope(),
      threadId: "thr_1",
      type: "turn/started",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("requires turn scope");
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
