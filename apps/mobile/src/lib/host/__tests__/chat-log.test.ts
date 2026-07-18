import { describe, expect, it } from "vitest";

import type { AppAgentEvent } from "@repo/features/agent-events";
// The reducer is the SHARED @repo/features fold now (it was extracted from
// this app verbatim); these assertions are intentionally byte-identical to the
// pre-extraction suite — they are the proof mobile behavior didn't change.
import {
  appendNotice,
  appendUser,
  applyAgentEvent,
  emptyChatLog,
  logFromHistory,
  type ChatLog,
} from "@repo/features/chat-log";
import type { ChatHistoryEntry } from "@repo/features/ipc-registry";

function fold(log: ChatLog, events: readonly AppAgentEvent[]): ChatLog {
  return events.reduce(applyAgentEvent, log);
}

// stripNoteContext itself is @repo/features/note-context's (tested there);
// logFromHistory's strip-on-rehydrate is asserted below.
describe("logFromHistory", () => {
  it("maps user/assistant entries and skips tool rows", () => {
    const history: ChatHistoryEntry[] = [
      { role: "user", text: "[Context: today is Monday.]\n\nrename my note" },
      { role: "tool", text: "…", toolName: "edit_file" },
      { role: "assistant", text: "Done." },
    ];
    const log = logFromHistory(history);
    expect(log.items).toEqual([
      { kind: "user", id: "c0", text: "rename my note" },
      { kind: "assistant", id: "c1", text: "Done.", streaming: false, isError: false },
    ]);
    expect(log.busy).toBe(false);
    expect(log.streamingId).toBeNull();
  });
});

describe("streaming turn", () => {
  it("accumulates deltas into one bubble and finalizes on message_end", () => {
    const log = fold(emptyChatLog, [
      { type: "agent_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_update", delta: "Hel" },
      { type: "message_update", delta: "lo" },
    ]);
    expect(log.busy).toBe(true);
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "Hello", streaming: true, isError: false },
    ]);

    const done = applyAgentEvent(log, {
      type: "message_end",
      role: "assistant",
      text: "Hello there.",
    });
    expect(done.streamingId).toBeNull();
    expect(done.items).toEqual([
      { kind: "assistant", id: "c0", text: "Hello there.", streaming: false, isError: false },
    ]);
  });

  it("drops the empty bubble of a tool-only turn", () => {
    const log = fold(emptyChatLog, [
      { type: "message_start", role: "assistant" },
      { type: "message_end", role: "assistant", text: "" },
    ]);
    expect(log.items).toEqual([]);
    expect(log.streamingId).toBeNull();
  });

  it("marks an error turn with the errorMessage", () => {
    const log = fold(emptyChatLog, [
      { type: "message_start", role: "assistant" },
      { type: "message_update", delta: "partial" },
      {
        type: "message_end",
        role: "assistant",
        text: "partial",
        stopReason: "error",
        errorMessage: "upstream exploded",
      },
    ]);
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "upstream exploded", streaming: false, isError: true },
    ]);
  });

  it("falls back to a placeholder when an error turn has no message at all", () => {
    const log = fold(emptyChatLog, [
      { type: "message_start", role: "assistant" },
      { type: "message_end", role: "assistant", text: "", stopReason: "error" },
    ]);
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

  it("ignores deltas when nothing is streaming, and non-assistant message_start", () => {
    expect(applyAgentEvent(emptyChatLog, { type: "message_update", delta: "x" })).toBe(
      emptyChatLog,
    );
    const log = applyAgentEvent(emptyChatLog, { type: "message_start", role: "user" });
    expect(log.items).toEqual([]);
  });
});

describe("tool rows", () => {
  const start: AppAgentEvent = {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "edit_file",
    args: {},
  };

  it("tracks running → done", () => {
    const running = applyAgentEvent(emptyChatLog, start);
    expect(running.items).toEqual([
      { kind: "tool", id: "c0", toolName: "edit_file", state: "running" },
    ]);

    const done = applyAgentEvent(running, {
      type: "tool_execution_end",
      toolCallId: "t1",
      isError: false,
      resultText: "ok",
    });
    expect(done.items).toEqual([{ kind: "tool", id: "c0", toolName: "edit_file", state: "done" }]);
    expect(done.tools.size).toBe(0);
  });

  it("tracks running → error", () => {
    const log = fold(emptyChatLog, [
      start,
      { type: "tool_execution_end", toolCallId: "t1", isError: true, resultText: "nope" },
    ]);
    expect(log.items).toEqual([{ kind: "tool", id: "c0", toolName: "edit_file", state: "error" }]);
  });

  it("ignores an end for an unknown toolCallId", () => {
    const log = applyAgentEvent(emptyChatLog, {
      type: "tool_execution_end",
      toolCallId: "ghost",
      isError: false,
      resultText: "",
    });
    expect(log).toBe(emptyChatLog);
  });

  it("agent_end sweeps still-running rows but keeps completed ones", () => {
    const log = fold(emptyChatLog, [
      { type: "agent_start" },
      start,
      { type: "tool_execution_end", toolCallId: "t1", isError: false, resultText: "ok" },
      { type: "tool_execution_start", toolCallId: "t2", toolName: "search_vault", args: {} },
      { type: "agent_end" },
    ]);
    expect(log.busy).toBe(false);
    expect(log.tools.size).toBe(0);
    expect(log.items).toEqual([{ kind: "tool", id: "c0", toolName: "edit_file", state: "done" }]);
  });
});

describe("appends + misc events", () => {
  it("appendUser / appendNotice allocate distinct ids", () => {
    const log = appendNotice(appendUser(emptyChatLog, "hi"), "not delivered");
    expect(log.items).toEqual([
      { kind: "user", id: "c0", text: "hi" },
      { kind: "assistant", id: "c1", text: "not delivered", streaming: false, isError: true },
    ]);
  });

  it("turn_error appends an error bubble", () => {
    const log = applyAgentEvent(emptyChatLog, {
      type: "turn_error",
      kind: "auth",
      reason: "Sign in again.",
    });
    expect(log.items).toEqual([
      { kind: "assistant", id: "c0", text: "Sign in again.", streaming: false, isError: true },
    ]);
  });

  it("queue_update is a no-op", () => {
    expect(
      applyAgentEvent(emptyChatLog, { type: "queue_update", steering: [], followUp: [] }),
    ).toBe(emptyChatLog);
  });
});
