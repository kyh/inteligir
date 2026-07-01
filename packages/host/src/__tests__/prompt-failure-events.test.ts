// ---------------------------------------------------------------------------
// PiAgent prompt-rejection visibility — the synthetic events pi-driver emits
// when session.prompt() rejects must parse into renderer-visible AppAgentEvents
// (message_start → error message_end → agent_end). This is the contract that
// makes a rejected prompt show up in the chat instead of vanishing.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { buildPromptFailureEvents } from "@repo/pi-driver/agent";

import { parseAgentEvent } from "@repo/core/agent-event-parser";

type ModelArg = Parameters<typeof buildPromptFailureEvents>[0];

const model: ModelArg = {
  id: "gpt-test",
  name: "Test Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4096,
};

describe("buildPromptFailureEvents", () => {
  it("produces a message_start the renderer turns into a bubble", () => {
    const [start] = buildPromptFailureEvents(model, "boom");
    expect(parseAgentEvent(start)).toEqual({ type: "message_start", role: "assistant" });
  });

  it("produces an error message_end carrying the rejection reason", () => {
    const [, end] = buildPromptFailureEvents(model, "provider exploded");
    expect(parseAgentEvent(end)).toEqual({
      type: "message_end",
      role: "assistant",
      text: "",
      stopReason: "error",
      errorMessage: "provider exploded",
    });
  });

  it("ends with agent_end so busy-state derived from events releases", () => {
    const events = buildPromptFailureEvents(model, "boom");
    expect(parseAgentEvent(events.at(-1))).toEqual({ type: "agent_end" });
  });
});
