import { describe, it, expect } from "vitest";
import { parseAgentEvent } from "@repo/bridge/agent-event-parser";

describe("parseAgentEvent", () => {
  it("parses agent_start", () => {
    expect(parseAgentEvent({ type: "agent_start" })).toEqual({ type: "agent_start" });
  });

  it("parses agent_end", () => {
    expect(parseAgentEvent({ type: "agent_end" })).toEqual({ type: "agent_end" });
  });

  it("parses message_start with assistant role", () => {
    const raw = { type: "message_start", message: { role: "assistant" } };
    expect(parseAgentEvent(raw)).toEqual({ type: "message_start", role: "assistant" });
  });

  it("parses message_start with user role", () => {
    const raw = { type: "message_start", message: { role: "user" } };
    expect(parseAgentEvent(raw)).toEqual({ type: "message_start", role: "user" });
  });

  it("returns null for message_start with unknown role", () => {
    const raw = { type: "message_start", message: { role: "system" } };
    expect(parseAgentEvent(raw)).toBeNull();
  });

  it("parses message_update text_delta", () => {
    const raw = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    };
    expect(parseAgentEvent(raw)).toEqual({ type: "message_update", delta: "hello" });
  });

  it("returns null for message_update with non-text_delta", () => {
    const raw = {
      type: "message_update",
      assistantMessageEvent: { type: "tool_call", delta: "x" },
    };
    expect(parseAgentEvent(raw)).toBeNull();
  });

  it("returns null for message_update with empty delta", () => {
    const raw = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta" },
    };
    expect(parseAgentEvent(raw)).toBeNull();
  });

  it("parses message_end and extracts text from content blocks", () => {
    const raw = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      },
    };
    expect(parseAgentEvent(raw)).toEqual({
      type: "message_end",
      role: "assistant",
      text: "hello world",
      stopReason: undefined,
    });
  });

  it("preserves stopReason on message_end", () => {
    // pi-coding-agent puts stopReason inside the message object, not at the
    // top level. The parser must read from message.stopReason.
    const raw = {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error" },
    };
    const result = parseAgentEvent(raw);
    expect(result?.type === "message_end" && result.stopReason).toBe("error");
  });

  it("preserves errorMessage on message_end", () => {
    const raw = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "Codex error: ...",
      },
    };
    const result = parseAgentEvent(raw);
    expect(result?.type === "message_end" && result.errorMessage).toBe("Codex error: ...");
  });

  it("parses tool_execution_start", () => {
    const raw = {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "browser",
    };
    expect(parseAgentEvent(raw)).toEqual({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "browser",
    });
  });

  it("parses tool_execution_end", () => {
    const raw = {
      type: "tool_execution_end",
      toolCallId: "tc-1",
      isError: false,
      result: { content: [{ type: "text", text: "done" }] },
    };
    expect(parseAgentEvent(raw)).toEqual({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      isError: false,
      resultText: "done",
    });
  });

  it("returns null for unknown event type", () => {
    expect(parseAgentEvent({ type: "compaction_start" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseAgentEvent(null)).toBeNull();
    expect(parseAgentEvent("string")).toBeNull();
    expect(parseAgentEvent(42)).toBeNull();
    expect(parseAgentEvent(undefined)).toBeNull();
  });

  it("returns null for malformed tool_execution_start (missing fields)", () => {
    expect(parseAgentEvent({ type: "tool_execution_start" })).toBeNull();
  });
});
