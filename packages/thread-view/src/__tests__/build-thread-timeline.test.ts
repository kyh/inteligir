import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import {
  applyTimelineDelta,
  computeTimelineDelta,
  threadTimelineSchema,
} from "@repo/api/local/thread-timeline";
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
    // Summary is the provider's visible thinking text; it wins over content.
    expect(reasoning.text).toBe("scanned");
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

  it("keeps delta application identical to a full rebuild — the WHOLE timeline value — at every prefix", () => {
    const events = stored(streamedTurnEvents());
    const full = buildThreadTimeline(events);
    for (let cut = 0; cut <= events.length; cut += 1) {
      const base = buildThreadTimeline(events.slice(0, cut));
      const delta = computeTimelineDelta(base, full);
      expect(delta.fromSequence).toBe(base.maxSequence);
      expect(applyTimelineDelta(base, delta)).toEqual(full);
    }
  });

  it("refuses a delta whose base is not the held timeline", () => {
    const events = stored(streamedTurnEvents());
    const full = buildThreadTimeline(events);
    const held = buildThreadTimeline(events.slice(0, 8));
    // The delta was computed against a different prefix than the one held.
    const staleDelta = computeTimelineDelta(buildThreadTimeline(events.slice(0, 5)), full);
    expect(applyTimelineDelta(held, staleDelta)).toBeNull();
    // And a matching base still applies cleanly.
    const freshDelta = computeTimelineDelta(buildThreadTimeline(events.slice(0, 8)), full);
    expect(applyTimelineDelta(held, freshDelta)).toEqual(full);
  });

  it("converges to the full rebuild under any interleaving of stale and fresh responses", () => {
    // The client protocol under test: hold a timeline, apply whatever delta
    // arrives; a null application means refetch in full. Deltas here are
    // computed against arbitrary bases — many of them stale — in a seeded
    // random interleaving, and every accepted state must equal the rebuild of
    // SOME event prefix (never a chimera), converging to the full rebuild.
    const events = stored(streamedTurnEvents());
    const prefixes = Array.from({ length: events.length + 1 }, (_, cut) =>
      buildThreadTimeline(events.slice(0, cut)),
    );
    const full = prefixes[events.length];
    if (!full) {
      throw new Error("expected the full projection");
    }
    for (let seed = 1; seed <= 50; seed += 1) {
      let state = seed;
      const random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const prefixAt = (index: number) => {
        const prefix = prefixes[index];
        if (!prefix) {
          throw new Error("prefix out of range");
        }
        return prefix;
      };
      let held = prefixAt(Math.floor(random() * prefixes.length));
      for (let step = 0; step < 20; step += 1) {
        const base = prefixAt(Math.floor(random() * prefixes.length));
        const target = prefixAt(Math.floor(random() * prefixes.length));
        const applied = applyTimelineDelta(held, computeTimelineDelta(base, target));
        held = applied ?? full;
        const expected = prefixes.find((prefix) => prefix.maxSequence === held.maxSequence);
        expect(held).toEqual(expected);
      }
      const finalDelta = computeTimelineDelta(
        prefixes.find((prefix) => prefix.maxSequence === held.maxSequence) ?? full,
        full,
      );
      held = applyTimelineDelta(held, finalDelta) ?? full;
      expect(held).toEqual(full);
    }
  });

  it("a streaming delta carries ONLY the row that streamed", () => {
    const events = stored(streamedTurnEvents());
    // Between deltas 10 and 11 only the assistant row's text changes.
    const before = buildThreadTimeline(events.slice(0, 10));
    const after = buildThreadTimeline(events.slice(0, 11));
    const delta = computeTimelineDelta(before, after);
    // Membership and order stay implicit.
    expect(delta.rowOrder).toBeUndefined();
    // The turn row must NOT ride along. It carries its whole subtree — the
    // reasoning and command rows of this turn — so sending it per token is a
    // full resend of the active turn on every frame.
    expect(delta.upsertRows.map((row) => row.id)).toEqual(["item:turn_1:item_a"]);
  });

  it("a turn row still upserts when one of its own children changes", () => {
    const events = stored(streamedTurnEvents());
    // Event 7 is the command's outputDelta — a child of the turn row.
    const before = buildThreadTimeline(events.slice(0, 6));
    const after = buildThreadTimeline(events.slice(0, 7));
    const delta = computeTimelineDelta(before, after);
    expect(delta.upsertRows.map((row) => row.id)).toContain("turn:turn_1");
  });

  it("projects an empty log to an empty timeline", () => {
    expect(buildThreadTimeline([])).toEqual({ rows: [], maxSequence: 0, tokenUsage: null });
  });
});

const findReasoningText = (timeline: ReturnType<typeof buildThreadTimeline>): string => {
  for (const row of timeline.rows) {
    if (row.kind !== "turn") {
      continue;
    }
    for (const child of row.children) {
      if (child.kind === "work" && child.workKind === "reasoning") {
        return child.text;
      }
    }
  }
  throw new Error("no reasoning row");
};

describe("reasoning text preference", () => {
  it("settled reasoning prefers summary, falls back to content, then the stream buffer", () => {
    const base = {
      threadId: THREAD_ID,
      scope: turnScope("turn_r"),
    };
    const build = (item: { summary: string[]; content: string[] }) =>
      buildThreadTimeline(
        stored([
          { type: "turn/started", ...base },
          {
            type: "item/started",
            ...base,
            item: { type: "reasoning", id: "item_r", summary: [], content: [] },
          },
          { type: "item/reasoning/summaryTextDelta", ...base, itemId: "item_r", delta: "strea" },
          { type: "item/reasoning/summaryTextDelta", ...base, itemId: "item_r", delta: "ming" },
          {
            type: "item/completed",
            ...base,
            item: { type: "reasoning", id: "item_r", ...item },
          },
          { type: "turn/completed", ...base, status: "completed" },
        ]),
      );

    expect(findReasoningText(build({ summary: ["visible"], content: ["raw"] }))).toBe("visible");
    expect(findReasoningText(build({ summary: [], content: ["raw"] }))).toBe("raw");
    // Codex-shaped: settles with both empty — the streamed summary buffer stands.
    expect(findReasoningText(build({ summary: [], content: [] }))).toBe("streaming");
  });
});
