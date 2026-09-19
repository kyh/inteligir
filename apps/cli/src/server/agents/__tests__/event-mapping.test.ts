import { threadEventSchema } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { mapProviderEvent } from "../event-mapping";

const providerScope = turnScope("cturn_1");

describe("provider event mapping", () => {
  it("rewrites turn-scoped events onto the host's turn id", () => {
    const result = mapProviderEvent(
      {
        delta: "hel",
        itemId: "citem_1",
        providerThreadId: "cthr_1",
        scope: providerScope,
        threadId: "thr_1",
        type: "item/agentMessage/delta",
      },
      "turn_host",
    );
    expect(result).toEqual({
      event: {
        delta: "hel",
        itemId: "citem_1",
        scope: turnScope("turn_host"),
        threadId: "thr_1",
        type: "item/agentMessage/delta",
      },
      kind: "mapped",
    });
  });

  it("maps every kept item kind onto a persisted item that still parses", () => {
    const items = [
      { id: "i1", text: "hi", type: "agentMessage" as const },
      { content: [], id: "i2", summary: ["s"], type: "reasoning" as const },
      {
        aggregatedOutput: "a.md",
        approvalStatus: null,
        command: "ls",
        cwd: "/vault",
        durationMs: 4,
        exitCode: 0,
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
        error: "boom",
        id: "i5",
        server: "mcp",
        status: "failed" as const,
        tool: "search",
        type: "toolCall" as const,
      },
      { id: "i6", text: "1. do", type: "plan" as const },
    ];
    for (const item of items) {
      const result = mapProviderEvent(
        {
          item,
          providerThreadId: "cthr_1",
          scope: providerScope,
          threadId: "thr_1",
          type: "item/completed",
        },
        "turn_host",
      );
      expect(result.kind).toBe("mapped");
      if (result.kind === "mapped") {
        expect(() => threadEventSchema.parse(result.event)).not.toThrow();
      }
    }
  });

  it("drops the user-message echo and the kinds with no persisted renderer", () => {
    const echo = mapProviderEvent(
      {
        item: { content: [{ text: "hi", type: "text" }], id: "u1", type: "userMessage" },
        providerThreadId: "cthr_1",
        scope: providerScope,
        threadId: "thr_1",
        type: "item/completed",
      },
      "turn_host",
    );
    expect(echo.kind).toBe("dropped");
    expect(echo.kind === "dropped" ? echo.reason : "").toContain("userMessage");

    const unknownKind = mapProviderEvent(
      {
        diff: "+x",
        providerThreadId: "cthr_1",
        scope: providerScope,
        threadId: "thr_1",
        type: "turn/diff/updated",
      },
      "turn_host",
    );
    expect(unknownKind).toMatchObject({ kind: "dropped" });
  });

  it("keeps a session-level provider error at thread scope", () => {
    const result = mapProviderEvent(
      {
        detail: "401",
        message: "Provider error",
        providerThreadId: "cthr_1",
        scope: threadScope(),
        threadId: "thr_1",
        type: "provider/error",
      },
      null,
    );
    expect(result).toEqual({
      event: {
        detail: "401",
        message: "Provider error",
        scope: threadScope(),
        threadId: "thr_1",
        type: "provider/error",
      },
      kind: "mapped",
    });
  });

  it("refuses turn-scoped events when no host turn is bound", () => {
    const result = mapProviderEvent(
      {
        providerThreadId: "cthr_1",
        scope: providerScope,
        status: "completed",
        threadId: "thr_1",
        type: "turn/completed",
      },
      null,
    );
    expect(result).toMatchObject({ kind: "dropped" });
  });
});
