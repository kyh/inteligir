import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import {
  applyTimelineDelta,
  computeTimelineRowDelta,
  threadTimelineSchema,
} from "@repo/server-contract/thread-timeline";
import { describe, expect, it } from "vitest";
import { buildThreadTimeline, type ThreadTimelineEvent } from "../build-thread-timeline";

const THREAD_ID = "thr_test";

function stored(events: readonly ThreadEvent[]): ThreadTimelineEvent[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    createdAt: 1_000 + index,
    event,
  }));
}

/** A full streamed turn: request, work, streamed answer, usage, completion. */
function streamedTurnEvents(): ThreadEvent[] {
  const turn = turnScope("turn_1");
  return [
    {
      type: "client/turn/requested",
      threadId: THREAD_ID,
      text: "What changed today?",
      kind: "message",
      scope: threadScope(),
    },
    { type: "turn/started", threadId: THREAD_ID, scope: turn },
    {
      type: "item/started",
      threadId: THREAD_ID,
      item: { type: "reasoning", id: "item_r", summary: [], content: [] },
      scope: turn,
    },
    {
      type: "item/reasoning/textDelta",
      threadId: THREAD_ID,
      itemId: "item_r",
      delta: "Scanning the vault…",
      scope: turn,
    },
    {
      type: "item/completed",
      threadId: THREAD_ID,
      item: {
        type: "reasoning",
        id: "item_r",
        summary: ["scanned"],
        content: ["Scanned the vault."],
      },
      scope: turn,
    },
    {
      type: "item/started",
      threadId: THREAD_ID,
      item: {
        type: "commandExecution",
        id: "item_c",
        command: "git log --oneline -3",
        cwd: "/vault",
        status: "pending",
        approvalStatus: null,
      },
      scope: turn,
    },
    {
      type: "item/commandExecution/outputDelta",
      threadId: THREAD_ID,
      itemId: "item_c",
      delta: "abc123 fix\n",
      scope: turn,
    },
    {
      type: "item/completed",
      threadId: THREAD_ID,
      item: {
        type: "commandExecution",
        id: "item_c",
        command: "git log --oneline -3",
        cwd: "/vault",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: "abc123 fix\ndef456 feat\n",
        exitCode: 0,
      },
      scope: turn,
    },
    {
      type: "item/started",
      threadId: THREAD_ID,
      item: { type: "agentMessage", id: "item_a", text: "" },
      scope: turn,
    },
    {
      type: "item/agentMessage/delta",
      threadId: THREAD_ID,
      itemId: "item_a",
      delta: "Two commits ",
      scope: turn,
    },
    {
      type: "item/agentMessage/delta",
      threadId: THREAD_ID,
      itemId: "item_a",
      delta: "landed today.",
      scope: turn,
    },
    {
      type: "item/completed",
      threadId: THREAD_ID,
      item: { type: "agentMessage", id: "item_a", text: "Two commits landed today." },
      scope: turn,
    },
    {
      type: "thread/tokenUsage/updated",
      threadId: THREAD_ID,
      tokenUsage: {
        total: {
          totalTokens: 120,
          inputTokens: 80,
          cachedInputTokens: 0,
          outputTokens: 40,
          reasoningOutputTokens: 5,
        },
        last: {
          totalTokens: 120,
          inputTokens: 80,
          cachedInputTokens: 0,
          outputTokens: 40,
          reasoningOutputTokens: 5,
        },
        modelContextWindow: 200_000,
      },
      scope: turn,
    },
    { type: "turn/completed", threadId: THREAD_ID, status: "completed", scope: turn },
  ];
}

describe("buildThreadTimeline", () => {
  it("projects the golden streamed turn", () => {
    const timeline = buildThreadTimeline(stored(streamedTurnEvents()));
    expect(threadTimelineSchema.parse(timeline)).toEqual(timeline);
    expect(timeline.maxSequence).toBe(14);
    expect(timeline.tokenUsage?.total.totalTokens).toBe(120);

    expect(timeline.rows.map((row) => ({ id: row.id, kind: row.kind }))).toEqual([
      { id: "user:1", kind: "conversation" },
      { id: "turn:turn_1", kind: "turn" },
      { id: "item:turn_1:item_a", kind: "conversation" },
    ]);

    const [user, turn, assistant] = timeline.rows;
    if (
      user?.kind !== "conversation" ||
      turn?.kind !== "turn" ||
      assistant?.kind !== "conversation"
    ) {
      throw new Error("unexpected row kinds");
    }
    expect(user.role).toBe("user");
    expect(user.text).toBe("What changed today?");
    expect(assistant.role).toBe("assistant");
    expect(assistant.text).toBe("Two commits landed today.");

    expect(turn.status).toBe("completed");
    expect(turn.completedAt).not.toBeNull();
    expect(turn.children.map((child) => child.id)).toEqual([
      "item:turn_1:item_r",
      "item:turn_1:item_c",
    ]);
    const [reasoning, command] = turn.children;
    if (reasoning?.kind !== "work" || command?.kind !== "work") {
      throw new Error("unexpected child kinds");
    }
    if (reasoning.workKind !== "reasoning" || command.workKind !== "command") {
      throw new Error("unexpected work kinds");
    }
    expect(reasoning.text).toBe("Scanned the vault.");
    expect(command.output).toBe("abc123 fix\ndef456 feat\n");
    expect(command.exitCode).toBe(0);
    expect(command.status).toBe("completed");
  });

  it("renders the streaming buffer while the item is open, then the final text", () => {
    const events = stored(streamedTurnEvents());
    const midStream = buildThreadTimeline(events.slice(0, 10));
    const assistant = midStream.rows.find((row) => row.id === "item:turn_1:item_a");
    if (assistant?.kind !== "conversation") {
      throw new Error("expected the streaming assistant row");
    }
    expect(assistant.text).toBe("Two commits ");
    const turn = midStream.rows.find((row) => row.id === "turn:turn_1");
    if (turn?.kind !== "turn") {
      throw new Error("expected the turn row");
    }
    expect(turn.status).toBe("pending");
  });

  it("places provider errors with their scope", () => {
    const turn = turnScope("turn_1");
    const timeline = buildThreadTimeline(
      stored([
        { type: "turn/started", threadId: THREAD_ID, scope: turn },
        {
          type: "provider/error",
          threadId: THREAD_ID,
          message: "in-turn failure",
          scope: turn,
        },
        {
          type: "turn/completed",
          threadId: THREAD_ID,
          status: "failed",
          error: { message: "in-turn failure" },
          scope: turn,
        },
        {
          type: "provider/error",
          threadId: THREAD_ID,
          message: "session failure",
          detail: "socket closed",
          scope: threadScope(),
        },
      ]),
    );
    const [turnRow, errorRow] = timeline.rows;
    if (turnRow?.kind !== "turn" || errorRow?.kind !== "error") {
      throw new Error("unexpected rows");
    }
    expect(turnRow.status).toBe("error");
    expect(turnRow.children.map((child) => child.kind)).toEqual(["error"]);
    expect(errorRow.message).toBe("session failure");
    expect(errorRow.detail).toBe("socket closed");
  });

  it("keeps delta application identical to a full rebuild at every prefix", () => {
    const events = stored(streamedTurnEvents());
    const full = buildThreadTimeline(events);
    for (let cut = 0; cut <= events.length; cut += 1) {
      const prefixRows = buildThreadTimeline(events.slice(0, cut)).rows;
      const delta = computeTimelineRowDelta(prefixRows, full.rows);
      expect(applyTimelineDelta(prefixRows, delta)).toEqual(full.rows);
    }
  });

  it("omits rowOrder while a row is merely streaming new content", () => {
    const events = stored(streamedTurnEvents());
    // Between deltas 10 and 11 only the assistant row's text changes.
    const before = buildThreadTimeline(events.slice(0, 10)).rows;
    const after = buildThreadTimeline(events.slice(0, 11)).rows;
    const delta = computeTimelineRowDelta(before, after);
    expect(delta.rowOrder).toBeUndefined();
    // The streaming row and its turn (whose sourceSeqEnd advanced) upsert;
    // membership and order stay implicit.
    expect(delta.upsertRows.map((row) => row.id)).toEqual(["turn:turn_1", "item:turn_1:item_a"]);
  });

  it("projects an empty log to an empty timeline", () => {
    expect(buildThreadTimeline([])).toEqual({ rows: [], maxSequence: 0, tokenUsage: null });
  });
});
