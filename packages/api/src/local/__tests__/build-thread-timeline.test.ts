import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { applyTimelineDelta, computeTimelineDelta, threadTimelineSchema } from "../thread-timeline";
import { describe, expect, it } from "vitest";
import { buildThreadTimeline } from "../build-thread-timeline";
import type { ThreadTimelineEvent } from "../build-thread-timeline";

const THREAD_ID = "thr_test";

const stored = (events: readonly ThreadEvent[]): ThreadTimelineEvent[] =>
  events.map((event, index) => ({
    createdAt: 1000 + index,
    event,
    sequence: index + 1,
  }));

const streamedTurnEvents = (): ThreadEvent[] => {
  const turn = turnScope("turn_1");
  return [
    {
      scope: threadScope(),
      text: "What changed today?",
      threadId: THREAD_ID,
      type: "client/turn/requested",
    },
    { scope: turn, threadId: THREAD_ID, type: "turn/started" },
    {
      item: { content: [], id: "item_r", summary: [], type: "reasoning" },
      scope: turn,
      threadId: THREAD_ID,
      type: "item/started",
    },
    {
      delta: "Scanning the vault…",
      itemId: "item_r",
      scope: turn,
      threadId: THREAD_ID,
      type: "item/reasoning/textDelta",
    },
    {
      item: {
        content: ["Scanned the vault."],
        id: "item_r",
        summary: ["scanned"],
        type: "reasoning",
      },
      scope: turn,
      threadId: THREAD_ID,
      type: "item/completed",
    },
    {
      item: {
        approvalStatus: null,
        command: "git log --oneline -3",
        cwd: "/vault",
        id: "item_c",
        status: "pending",
        type: "commandExecution",
      },
      scope: turn,
      threadId: THREAD_ID,
      type: "item/started",
    },
    {
      delta: "abc123 fix\n",
      itemId: "item_c",
      scope: turn,
      threadId: THREAD_ID,
      type: "item/commandExecution/outputDelta",
    },
    {
      item: {
        aggregatedOutput: "abc123 fix\ndef456 feat\n",
        approvalStatus: null,
        command: "git log --oneline -3",
        cwd: "/vault",
        exitCode: 0,
        id: "item_c",
        status: "completed",
        type: "commandExecution",
      },
      scope: turn,
      threadId: THREAD_ID,
      type: "item/completed",
    },
    {
      item: { id: "item_a", text: "", type: "agentMessage" },
      scope: turn,
      threadId: THREAD_ID,
      type: "item/started",
    },
    {
      delta: "Two commits ",
      itemId: "item_a",
      scope: turn,
      threadId: THREAD_ID,
      type: "item/agentMessage/delta",
    },
    {
      delta: "landed today.",
      itemId: "item_a",
      scope: turn,
      threadId: THREAD_ID,
      type: "item/agentMessage/delta",
    },
    {
      item: { id: "item_a", text: "Two commits landed today.", type: "agentMessage" },
      scope: turn,
      threadId: THREAD_ID,
      type: "item/completed",
    },
    {
      scope: turn,
      threadId: THREAD_ID,
      tokenUsage: {
        last: {
          cachedInputTokens: 0,
          inputTokens: 80,
          outputTokens: 40,
          reasoningOutputTokens: 5,
          totalTokens: 120,
        },
        modelContextWindow: 200_000,
        total: {
          cachedInputTokens: 0,
          inputTokens: 80,
          outputTokens: 40,
          reasoningOutputTokens: 5,
          totalTokens: 120,
        },
      },
      type: "thread/tokenUsage/updated",
    },
    { scope: turn, status: "completed", threadId: THREAD_ID, type: "turn/completed" },
  ];
};

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
        { scope: turn, threadId: THREAD_ID, type: "turn/started" },
        {
          message: "in-turn failure",
          scope: turn,
          threadId: THREAD_ID,
          type: "provider/error",
        },
        {
          error: { message: "in-turn failure" },
          scope: turn,
          status: "failed",
          threadId: THREAD_ID,
          type: "turn/completed",
        },
        {
          detail: "socket closed",
          message: "session failure",
          scope: threadScope(),
          threadId: THREAD_ID,
          type: "provider/error",
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
    const staleDelta = computeTimelineDelta(buildThreadTimeline(events.slice(0, 5)), full);
    expect(applyTimelineDelta(held, staleDelta)).toBeNull();
    const freshDelta = computeTimelineDelta(buildThreadTimeline(events.slice(0, 8)), full);
    expect(applyTimelineDelta(held, freshDelta)).toEqual(full);
  });

  it("converges to the full rebuild under any interleaving of stale and fresh responses", () => {
    const events = stored(streamedTurnEvents());
    const prefixes = Array.from({ length: events.length + 1 }, (_, cut) =>
      buildThreadTimeline(events.slice(0, cut)),
    );
    const full = prefixes[events.length];
    if (!full) {
      throw new Error("expected the full projection");
    }
    for (let seed = 1; seed <= 50; seed += 1) {
      // MINSTD: the interleaving has to be reproducible across runs, not statistically strong,
      // and its multiply stays exact in a double
      let state = seed;
      const random = () => {
        state = (state * 48_271) % 2_147_483_647;
        return state / 2_147_483_647;
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
        const heldMaxSequence = held.maxSequence;
        const expected = prefixes.find((prefix) => prefix.maxSequence === heldMaxSequence);
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
    // between events 10 and 11 only the assistant row's text changes
    const before = buildThreadTimeline(events.slice(0, 10));
    const after = buildThreadTimeline(events.slice(0, 11));
    const delta = computeTimelineDelta(before, after);
    expect(delta.rowOrder).toBeUndefined();
    expect(delta.upsertRows.map((row) => row.id)).toEqual(["item:turn_1:item_a"]);
  });

  it("a turn row still upserts when one of its own children changes", () => {
    const events = stored(streamedTurnEvents());
    // event 7 is the command's outputDelta, a child of the turn row
    const before = buildThreadTimeline(events.slice(0, 6));
    const after = buildThreadTimeline(events.slice(0, 7));
    const delta = computeTimelineDelta(before, after);
    expect(delta.upsertRows.map((row) => row.id)).toContain("turn:turn_1");
  });

  it("projects an empty log to an empty timeline", () => {
    expect(buildThreadTimeline([])).toEqual({ maxSequence: 0, rows: [], tokenUsage: null });
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
      scope: turnScope("turn_r"),
      threadId: THREAD_ID,
    };
    const build = (item: { summary: string[]; content: string[] }) =>
      buildThreadTimeline(
        stored([
          { type: "turn/started", ...base },
          {
            type: "item/started",
            ...base,
            item: { content: [], id: "item_r", summary: [], type: "reasoning" },
          },
          { type: "item/reasoning/summaryTextDelta", ...base, delta: "strea", itemId: "item_r" },
          { type: "item/reasoning/summaryTextDelta", ...base, delta: "ming", itemId: "item_r" },
          {
            type: "item/completed",
            ...base,
            item: { id: "item_r", type: "reasoning", ...item },
          },
          { type: "turn/completed", ...base, status: "completed" },
        ]),
      );

    expect(findReasoningText(build({ content: ["raw"], summary: ["visible"] }))).toBe("visible");
    expect(findReasoningText(build({ content: ["raw"], summary: [] }))).toBe("raw");
    expect(findReasoningText(build({ content: [], summary: [] }))).toBe("streaming");
  });
});
