import { threadEventSchema } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { mapProviderEvent } from "../event-mapping";

const scope = turnScope("turn_1");

describe("provider event mapping", () => {
  it("carries an event's turn scope onto the persisted event", () => {
    const result = mapProviderEvent({
      delta: "hel",
      itemId: "citem_1",
      scope,
      threadId: "thr_1",
      type: "item/agentMessage/delta",
    });
    expect(result).toEqual({
      delta: "hel",
      itemId: "citem_1",
      scope,
      threadId: "thr_1",
      type: "item/agentMessage/delta",
    });
  });

  it("maps every item kind onto a persisted item that still parses", () => {
    const items = [
      { id: "i1", text: "hi", type: "agentMessage" as const },
      { id: "i2", text: "thinking", type: "reasoning" as const },
      {
        aggregatedOutput: "a.md",
        approvalStatus: null,
        command: "ls",
        cwd: "/vault",
        id: "i3",
        status: "completed" as const,
        type: "commandExecution" as const,
      },
      {
        approvalStatus: null,
        changes: [{ diff: "+x", kind: "update" as const, movePath: "b.md", path: "a.md" }],
        id: "i4",
        status: "completed" as const,
        type: "fileChange" as const,
      },
      {
        arguments: { q: "x" },
        id: "i5",
        result: "no hits",
        status: "failed" as const,
        tool: "search",
        type: "toolCall" as const,
      },
    ];
    for (const item of items) {
      const result = mapProviderEvent({
        item,
        scope,
        threadId: "thr_1",
        type: "item/completed",
      });
      expect(threadEventSchema.parse(result)).toEqual(result);
    }
  });

  it("carries a turn's failure class onto the persisted error", () => {
    const result = mapProviderEvent({
      failure: "usage-limit",
      message: "Claude says you've reached your plan's usage limit.",
      scope,
      threadId: "thr_1",
      type: "provider/error",
    });
    expect(result).toEqual({
      failure: "usage-limit",
      message: "Claude says you've reached your plan's usage limit.",
      scope,
      threadId: "thr_1",
      type: "provider/error",
    });
  });
});
