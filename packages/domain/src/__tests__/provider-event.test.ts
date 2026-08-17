import { describe, expect, it } from "vitest";
import { getThreadEventItemRef, threadEventSchema } from "../provider-event";
import { threadScope, turnScope } from "../thread-event-scope";

describe("threadEventSchema scope validation", () => {
  it("refuses a turn-only event under thread scope at parse", () => {
    const result = threadEventSchema.safeParse({
      type: "turn/started",
      threadId: "thr_1",
      scope: threadScope(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("requires turn scope");
    }
  });

  it("refuses a turn-scoped frame with no turnId at parse", () => {
    const result = threadEventSchema.safeParse({
      type: "item/agentMessage/delta",
      threadId: "thr_1",
      itemId: "item_1",
      delta: "hi",
      scope: { kind: "turn" },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a thread-only event under turn scope", () => {
    const result = threadEventSchema.safeParse({
      type: "client/turn/requested",
      threadId: "thr_1",
      text: "hello",
      kind: "message",
      scope: turnScope("turn_1"),
    });
    expect(result.success).toBe(false);
  });

  it("accepts provider/error under either scope", () => {
    for (const scope of [threadScope(), turnScope("turn_1")]) {
      const result = threadEventSchema.safeParse({
        type: "provider/error",
        threadId: "thr_1",
        message: "boom",
        scope,
      });
      expect(result.success).toBe(true);
    }
  });

  it("round-trips a streamed item event", () => {
    const event = threadEventSchema.parse({
      type: "item/completed",
      threadId: "thr_1",
      item: { type: "agentMessage", id: "item_1", text: "done" },
      scope: turnScope("turn_1"),
    });
    expect(event.type).toBe("item/completed");
    expect(getThreadEventItemRef(event)).toEqual({
      itemId: "item_1",
      itemKind: "agentMessage",
    });
  });

  it("derives item refs for deltas without inventing a kind", () => {
    const event = threadEventSchema.parse({
      type: "item/agentMessage/delta",
      threadId: "thr_1",
      itemId: "item_1",
      delta: "chunk",
      scope: turnScope("turn_1"),
    });
    expect(getThreadEventItemRef(event)).toEqual({ itemId: "item_1", itemKind: null });
  });
});
