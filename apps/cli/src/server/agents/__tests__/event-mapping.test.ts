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
      event: {
        delta: "hel",
        itemId: "citem_1",
        scope,
        threadId: "thr_1",
        type: "item/agentMessage/delta",
      },
      kind: "mapped",
    });
  });

  it("maps every item kind onto a persisted item that still parses", () => {
    const items = [
      { id: "i1", text: "hi", type: "agentMessage" as const },
      { content: [], id: "i2", summary: ["s"], type: "reasoning" as const },
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
      expect(result.kind).toBe("mapped");
      if (result.kind === "mapped") {
        expect(() => threadEventSchema.parse(result.event)).not.toThrow();
      }
    }
  });

  it("drops the kinds with no persisted renderer, naming them", () => {
    const plan = mapProviderEvent({
      plan: [{ status: "active", step: "read the note" }],
      scope,
      threadId: "thr_1",
      type: "turn/plan/updated",
    });
    expect(plan).toEqual({ kind: "dropped", reason: "turn/plan/updated has no persisted mapping" });

    const progress = mapProviderEvent({
      itemId: "call_1",
      message: "Read note.md",
      scope,
      threadId: "thr_1",
      type: "item/toolCall/progress",
    });
    expect(progress).toMatchObject({ kind: "dropped" });

    const notice = mapProviderEvent({
      message: "Skill descriptions were shortened.",
      scope,
      severity: "warning",
      threadId: "thr_1",
      type: "provider/notice",
    });
    expect(notice).toEqual({
      kind: "dropped",
      reason:
        "provider/notice has no persisted mapping: warning: Skill descriptions were shortened.",
    });
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
      event: {
        failure: "usage-limit",
        message: "Claude says you've reached your plan's usage limit.",
        scope,
        threadId: "thr_1",
        type: "provider/error",
      },
      kind: "mapped",
    });
  });
});
