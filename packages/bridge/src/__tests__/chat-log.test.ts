// ---------------------------------------------------------------------------
// The shared chat-log fold over the recorded event corpus. This suite pins the
// END STATE of whole recorded turns — including the `detail` side-table (tool
// args/results, error kind) the workspace's UIMessage projection consumes;
// the per-transition behaviour is pinned beside the reducer itself.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import type { AppAgentEvent } from "../agent-events";
import { applyAgentEvent, emptyChatLog, logFromHistory, type ChatLog } from "../chat-log";
import {
  chatEventFixtures,
  historyFixture,
  historyWithErrorFixture,
  type ChatEventFixture,
} from "./chat-log-fixtures";

function fold(events: readonly AppAgentEvent[], from: ChatLog = emptyChatLog): ChatLog {
  return events.reduce(applyAgentEvent, from);
}

function fixture(name: string): ChatEventFixture {
  const found = chatEventFixtures.find((f) => f.name === name);
  if (found === undefined) throw new Error(`unknown fixture: ${name}`);
  return found;
}

describe("recorded turns — end state", () => {
  it("simple text turn: one finalized bubble, idle log", () => {
    const log = fold(fixture("simple text turn").events);
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "Hello there.", streaming: false, isError: false },
    ]);
    expect(log.busy).toBe(false);
    expect(log.streamingId).toBeNull();
    expect(log.tools.size).toBe(0);
    expect(log.detail.size).toBe(0);
  });

  it("tool call with result: empty bubble dropped, tool row done with detail", () => {
    const log = fold(fixture("tool call with result").events);
    expect(log.items).toEqual([
      { kind: "tool", id: "c1", toolName: "edit_file", state: "done" },
      { kind: "assistant", id: "c2", text: "Renamed the note.", streaming: false, isError: false },
    ]);
    expect(log.detail.get("c1")).toEqual({
      kind: "tool",
      toolCallId: "t1",
      args: { path: "notes/plan.md" },
      resultText: "3 lines edited",
    });
  });

  it("tool failure mid-turn: error row keeps its failure text", () => {
    const log = fold(fixture("tool failure mid-turn").events);
    expect(log.items).toEqual([
      { kind: "tool", id: "c0", toolName: "search_vault", state: "error" },
      {
        kind: "assistant",
        id: "c1",
        text: "The search failed; try again.",
        streaming: false,
        isError: false,
      },
    ]);
    expect(log.detail.get("c0")).toEqual({
      kind: "tool",
      toolCallId: "t1",
      args: { query: "roadmap" },
      resultText: "index locked",
    });
  });

  it("model error mid-turn: bubble becomes the errorMessage", () => {
    const log = fold(fixture("model error mid-turn").events);
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "upstream exploded", streaming: false, isError: true },
    ]);
    // message_end errors have no reported kind — no detail entry; consumers
    // treat a detail-less error item as cause-unknown.
    expect(log.detail.size).toBe(0);
  });

  it("model error without any message: placeholder text", () => {
    const log = fold(fixture("model error without any message").events);
    expect(log.items).toEqual([
      {
        kind: "assistant",
        id: "c0",
        text: "The model returned no response.",
        streaming: false,
        isError: true,
      },
    ]);
  });

  it("turn_error records the kind in detail", () => {
    const log = fold(fixture("synthetic turn_error (auth)").events);
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "Sign in again.", streaming: false, isError: true },
    ]);
    expect(log.detail.get("c0")).toEqual({ kind: "error", errorKind: "auth" });
  });

  it("multi-turn: completed rows persist, the never-ended tool is swept with its detail", () => {
    const log = fold(fixture("multi-turn with a swept still-running tool").events);
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "First answer.", streaming: false, isError: false },
      { kind: "tool", id: "c1", toolName: "get_backlinks", state: "done" },
      { kind: "assistant", id: "c3", text: "Second answer.", streaming: false, isError: false },
    ]);
    expect(log.detail.has("c1")).toBe(true);
    expect(log.detail.has("c2")).toBe(false); // swept row's detail went with it
    expect(log.tools.size).toBe(0);
    expect(log.busy).toBe(false);
  });

  it("stray events leave the log untouched (by identity)", () => {
    expect(fold(fixture("stray events are inert").events)).toBe(emptyChatLog);
  });

  it("mid-stream: deltas accumulate under a live streamingId", () => {
    const { events } = fixture("simple text turn");
    const mid = fold(events.slice(0, 4)); // through both deltas
    expect(mid.busy).toBe(true);
    expect(mid.streamingId).toBe("c0");
    expect(mid.items).toEqual([
      { kind: "assistant", id: "c0", text: "Hello", streaming: true, isError: false },
    ]);
  });
});

describe("history rehydration", () => {
  it("maps user/assistant, strips the context prefix, skips tool rows", () => {
    const log = logFromHistory(historyFixture);
    expect(log.items).toEqual([
      { kind: "user", id: "c0", text: "rename my note" },
      {
        kind: "assistant",
        id: "c1",
        text: "Done — renamed to plan.md.",
        streaming: false,
        isError: false,
      },
      { kind: "user", id: "c2", text: "thanks" },
      { kind: "assistant", id: "c3", text: "Anytime.", streaming: false, isError: false },
    ]);
    expect(log.busy).toBe(false);
    expect(log.streamingId).toBeNull();
  });

  it("preserves an errored turn's failure styling", () => {
    const log = logFromHistory(historyWithErrorFixture);
    expect(log.items).toEqual([
      { kind: "user", id: "c0", text: "hello" },
      { kind: "assistant", id: "c1", text: "upstream exploded", streaming: false, isError: true },
    ]);
  });

  it("live events continue id allocation after a rehydrate (no collisions)", () => {
    const log = fold(fixture("simple text turn").events, logFromHistory(historyFixture));
    const ids = log.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe("c4");
  });
});
