// Golden mapping from the runtime's provider grammar onto @repo/domain's
// persisted grammar: what survives (with the host's turn id stamped), what
// drops (with a stated reason), and that every mapped event still parses
// under the persisted schema — the same parse the append path runs.

import { threadEventSchema } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { mapProviderEvent } from "../event-mapping";

const providerScope = turnScope("cturn_1");

describe("provider event mapping", () => {
  it("rewrites turn-scoped events onto the host's turn id", () => {
    const result = mapProviderEvent(
      {
        type: "item/agentMessage/delta",
        threadId: "thr_1",
        providerThreadId: "cthr_1",
        scope: providerScope,
        itemId: "citem_1",
        delta: "hel",
      },
      "turn_host",
    );
    expect(result).toEqual({
      kind: "mapped",
      event: {
        type: "item/agentMessage/delta",
        threadId: "thr_1",
        scope: turnScope("turn_host"),
        itemId: "citem_1",
        delta: "hel",
      },
    });
  });

  it("maps every kept item kind onto a persisted item that still parses", () => {
    const items = [
      { type: "agentMessage" as const, id: "i1", text: "hi" },
      { type: "reasoning" as const, id: "i2", summary: ["s"], content: [] },
      {
        type: "commandExecution" as const,
        id: "i3",
        command: "ls",
        cwd: "/vault",
        status: "completed" as const,
        approvalStatus: null,
        aggregatedOutput: "a.md",
        exitCode: 0,
        durationMs: 4,
      },
      {
        type: "fileChange" as const,
        id: "i4",
        changes: [{ path: "a.md", kind: "update" as const, movePath: "b.md", diff: "+x" }],
        status: "completed" as const,
        approvalStatus: null,
      },
      {
        type: "toolCall" as const,
        id: "i5",
        server: "mcp",
        tool: "search",
        arguments: { q: "x" },
        status: "failed" as const,
        error: "boom",
      },
      { type: "plan" as const, id: "i6", text: "1. do" },
    ];
    for (const item of items) {
      const result = mapProviderEvent(
        {
          type: "item/completed",
          threadId: "thr_1",
          providerThreadId: "cthr_1",
          scope: providerScope,
          item,
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
        type: "item/completed",
        threadId: "thr_1",
        providerThreadId: "cthr_1",
        scope: providerScope,
        item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] },
      },
      "turn_host",
    );
    expect(echo).toMatchObject({ kind: "dropped", reason: expect.stringContaining("userMessage") });

    const unknownKind = mapProviderEvent(
      {
        type: "turn/diff/updated",
        threadId: "thr_1",
        providerThreadId: "cthr_1",
        scope: providerScope,
        diff: "+x",
      },
      "turn_host",
    );
    expect(unknownKind).toMatchObject({ kind: "dropped" });
  });

  it("keeps a session-level provider error at thread scope", () => {
    const result = mapProviderEvent(
      {
        type: "provider/error",
        threadId: "thr_1",
        providerThreadId: "cthr_1",
        scope: threadScope(),
        message: "Provider error",
        detail: "401",
      },
      null,
    );
    expect(result).toEqual({
      kind: "mapped",
      event: {
        type: "provider/error",
        threadId: "thr_1",
        scope: threadScope(),
        message: "Provider error",
        detail: "401",
      },
    });
  });

  it("refuses turn-scoped events when no host turn is bound", () => {
    const result = mapProviderEvent(
      {
        type: "turn/completed",
        threadId: "thr_1",
        providerThreadId: "cthr_1",
        scope: providerScope,
        status: "completed",
      },
      null,
    );
    expect(result).toMatchObject({ kind: "dropped" });
  });
});
