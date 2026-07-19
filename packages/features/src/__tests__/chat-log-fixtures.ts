// ---------------------------------------------------------------------------
// Recorded AppAgentEvent sequences (+ persisted-history samples) for the
// shared chat-log fold. ONE corpus, two consumers: the reducer unit tests
// here, and the desktop parity test (apps/desktop …/chat-log-parity.test.ts)
// that proves the shared fold + UIMessage projection reproduce the renderer's
// pre-extraction inline fold. Extend here and both sides pick it up.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "../agent-events";
import type { ChatHistoryEntry } from "../chat-log";

export type ChatEventFixture = {
  readonly name: string;
  readonly events: readonly AppAgentEvent[];
};

export const chatEventFixtures: readonly ChatEventFixture[] = [
  {
    name: "simple text turn",
    events: [
      { type: "agent_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_update", delta: "Hel" },
      { type: "message_update", delta: "lo" },
      { type: "message_end", role: "assistant", text: "Hello there." },
      { type: "agent_end" },
    ],
  },
  {
    name: "tool call with result",
    events: [
      { type: "agent_start" },
      // Tool-only assistant step: empty bubble streamed then dropped.
      { type: "message_start", role: "assistant" },
      { type: "message_end", role: "assistant", text: "" },
      {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "edit_file",
        args: { path: "notes/plan.md" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        isError: false,
        resultText: "3 lines edited",
      },
      { type: "message_start", role: "assistant" },
      { type: "message_update", delta: "Renamed" },
      { type: "message_update", delta: " the note." },
      { type: "message_end", role: "assistant", text: "Renamed the note." },
      { type: "agent_end" },
    ],
  },
  {
    name: "tool failure mid-turn",
    events: [
      { type: "agent_start" },
      {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "search_vault",
        args: { query: "roadmap" },
      },
      { type: "tool_execution_end", toolCallId: "t1", isError: true, resultText: "index locked" },
      { type: "message_start", role: "assistant" },
      { type: "message_end", role: "assistant", text: "The search failed; try again." },
      { type: "agent_end" },
    ],
  },
  {
    name: "model error mid-turn",
    events: [
      { type: "agent_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_update", delta: "partial" },
      {
        type: "message_end",
        role: "assistant",
        text: "partial",
        stopReason: "error",
        errorMessage: "upstream exploded",
      },
      { type: "agent_end" },
    ],
  },
  {
    name: "model error without any message",
    events: [
      { type: "agent_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_end", role: "assistant", text: "", stopReason: "error" },
      { type: "agent_end" },
    ],
  },
  {
    name: "synthetic turn_error (auth)",
    events: [
      { type: "agent_start" },
      { type: "turn_error", kind: "auth", reason: "Sign in again." },
      { type: "agent_end" },
    ],
  },
  {
    name: "multi-turn with a swept still-running tool",
    events: [
      { type: "agent_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_update", delta: "First answer." },
      { type: "message_end", role: "assistant", text: "First answer." },
      { type: "agent_end" },
      { type: "agent_start" },
      {
        type: "tool_execution_start",
        toolCallId: "tA",
        toolName: "get_backlinks",
        args: { path: "notes/plan.md" },
      },
      { type: "tool_execution_end", toolCallId: "tA", isError: false, resultText: "2 backlinks" },
      // tB never ends — agent_end must sweep its spinning row.
      { type: "tool_execution_start", toolCallId: "tB", toolName: "read_file", args: {} },
      { type: "message_start", role: "assistant" },
      { type: "message_end", role: "assistant", text: "Second answer." },
      { type: "agent_end" },
    ],
  },
  {
    name: "stray events are inert",
    events: [
      { type: "message_update", delta: "ghost" },
      { type: "tool_execution_end", toolCallId: "ghost", isError: false, resultText: "" },
      { type: "message_start", role: "user" },
      { type: "queue_update", steering: ["s"], followUp: ["f"] },
    ],
  },
];

/** A persisted thread: context-prefixed user turn, answer, a tool row (must
 * be skipped on rehydrate), and a follow-up exchange. */
export const historyFixture: readonly ChatHistoryEntry[] = [
  { role: "user", text: "[Context: today is Monday.]\n\nrename my note" },
  { role: "tool", text: "…", toolName: "edit_file", toolCallId: "t1" },
  { role: "assistant", text: "Done — renamed to plan.md." },
  { role: "user", text: "thanks" },
  { role: "assistant", text: "Anytime." },
];

/** A persisted thread whose last assistant turn errored (isError). The two
 * platforms historically DIVERGED here: mobile preserved the error styling on
 * rehydrate, the desktop inline fold dropped it. The shared fold preserves it
 * (see the parity test's divergence pin). */
export const historyWithErrorFixture: readonly ChatHistoryEntry[] = [
  { role: "user", text: "hello" },
  { role: "assistant", text: "upstream exploded", isError: true },
];
