import { QueryClient } from "@tanstack/query-core";
import type { AgentEvent } from "@repo/contract/library/agent-events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_HOLD_MS, followNoteEdits, openNoteEdits } from "./agent-note-holds";
import type { NoteEditMove } from "./agent-note-holds";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";
const OTHER_THREAD = "0199a4c2-0000-7000-8000-0000000000e2";
const NOTE = "0199a4c2-0000-7000-8000-0000000000a1";

let line = 0;
const row = (event: AgentEvent) => {
  line += 1;
  return { at: line, event, eventId: `1:${String(line)}:0`, threadId: THREAD, type: "agent" };
};

const editing = (toolUseId: string, id = NOTE) =>
  row({ input: { id, ops: [] }, name: "edit_item", toolUseId, type: "agent.tool_use" });
const reading = (toolUseId: string) =>
  row({ input: { id: NOTE }, name: "read_item", toolUseId, type: "agent.tool_use" });
const result = (toolUseId: string) =>
  row({ isError: false, summary: "", toolUseId, type: "agent.tool_result" });
const ended = () => row({ reason: "done", turn: 1, type: "turn.ended" });

const eventsKey = (threadId?: string) =>
  threadId === undefined
    ? ["library", "agent", "events"]
    : ["library", "agent", "events", { input: { threadId } }];

describe("the agent's edits of a note in a conversation's events", () => {
  it("holds an edit_item call from its use until its result, by the item it edits", () => {
    const open = openNoteEdits([editing("call-1"), reading("call-2")]);
    expect([...open]).toStrictEqual([["call-1", NOTE]]);
    expect([...openNoteEdits([result("call-1")], open)]).toStrictEqual([]);
  });

  it("lets every call go at the end of its turn, and passes over rows it cannot read", () => {
    expect([...openNoteEdits([editing("call-1"), { not: "a row" }, ended()])]).toStrictEqual([]);
    expect([
      ...openNoteEdits([
        row({ input: {}, name: "edit_item", toolUseId: "x", type: "agent.tool_use" }),
      ]),
    ]).toStrictEqual([]);
  });
});

describe("following the agent's edits across the conversations a device holds", () => {
  let queryClient: QueryClient;
  let moves: NoteEditMove[];
  let stop: () => void;

  const follow = (): void => {
    stop = followNoteEdits(queryClient.getQueryCache(), eventsKey(), (move) => {
      moves.push(move);
    });
  };

  const holding = (threadId: string, rows: readonly unknown[]): void => {
    queryClient.setQueryData(eventsKey(threadId), { draft: "", rows });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    moves = [];
    stop = () => {};
  });

  afterEach(() => {
    stop();
    queryClient.clear();
    vi.useRealTimers();
  });

  it("tells a call as it starts and as its result lands", () => {
    follow();
    const use = editing("call-1");
    holding(THREAD, [use]);
    expect(moves).toStrictEqual([{ callId: "call-1", itemId: NOTE, phase: "started" }]);
    holding(THREAD, [use, result("call-1")]);
    expect(moves.at(-1)).toStrictEqual({ callId: "call-1", itemId: NOTE, phase: "finished" });
  });

  it("tells a call open as following begins, and never one closed before it", () => {
    holding(THREAD, [editing("call-1"), result("call-1")]);
    holding(OTHER_THREAD, [editing("call-2")]);
    follow();
    expect(moves).toStrictEqual([{ callId: "call-2", itemId: NOTE, phase: "started" }]);
  });

  it("reads no row twice as a reply's draft grows", () => {
    follow();
    const rows = [editing("call-1")];
    holding(THREAD, rows);
    queryClient.setQueryData(eventsKey(THREAD), { draft: "Work", rows });
    queryClient.setQueryData(eventsKey(THREAD), { draft: "Working", rows });
    expect(moves).toHaveLength(1);
  });

  it("lets a call go a minute after it began when no result comes, and once only", () => {
    follow();
    const use = editing("call-1");
    holding(THREAD, [use]);
    vi.advanceTimersByTime(AGENT_HOLD_MS);
    expect(moves.at(-1)).toStrictEqual({ callId: "call-1", itemId: NOTE, phase: "finished" });
    holding(THREAD, [use, result("call-1")]);
    expect(moves).toHaveLength(2);
  });

  it("lets every call of a conversation go once the device lets the conversation go", () => {
    follow();
    holding(THREAD, [editing("call-1")]);
    queryClient.removeQueries({ queryKey: eventsKey(THREAD) });
    expect(moves.at(-1)).toStrictEqual({ callId: "call-1", itemId: NOTE, phase: "finished" });
  });

  it("follows nothing outside the conversations' events, and stops when asked", () => {
    follow();
    queryClient.setQueryData(["library", "items"], { rows: [editing("call-9")] });
    expect(moves).toStrictEqual([]);
    stop();
    holding(THREAD, [editing("call-1")]);
    expect(moves).toStrictEqual([]);
  });
});
