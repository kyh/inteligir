import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  utf8ByteLength,
  type AgentEvent,
  type DispatchMessage,
} from "./protocol";

const agentEvents: AgentEvent[] = [
  { type: "agent_start" },
  { type: "agent_end" },
  { type: "message_start", role: "assistant" },
  { type: "message_update", delta: "tok" },
  { type: "message_end", role: "assistant", text: "answer", stopReason: "stop" },
  {
    type: "message_end",
    role: "assistant",
    text: "",
    stopReason: "error",
    errorMessage: "model exploded",
  },
  { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { cmd: "ls" } },
  { type: "tool_execution_start", toolCallId: "t2", toolName: "read" },
  { type: "tool_execution_end", toolCallId: "t1", isError: false, resultText: "ok" },
  { type: "queue_update", steering: ["go left"], followUp: [] },
  { type: "turn_error", kind: "auth", reason: "not signed in" },
];

const samples: DispatchMessage[] = [
  { v: 1, type: "user_message", text: "hi" },
  { v: 1, type: "steer", text: "go left" },
  { v: 1, type: "interrupt" },
  ...agentEvents.map((event): DispatchMessage => ({ v: 1, type: "agent_event", event })),
  {
    v: 1,
    type: "chat_message",
    correlationId: "c1",
    text: "hello",
    conversation: { platform: "slack", channelId: "C1", userId: "U1", isDM: false },
  },
  { v: 1, type: "chat_message", correlationId: "c2", text: "no conversation" },
  { v: 1, type: "chat_reply", correlationId: "c1", text: "done" },
  { v: 1, type: "presence", peers: [{ role: "desktop" }, { role: "mobile" }] },
  { v: 1, type: "presence", peers: [] },
  { v: 1, type: "peer_joined", role: "mobile" },
  { v: 1, type: "peer_left", role: "desktop" },
  { v: 1, type: "room_teardown" },
  { v: 1, type: "error", code: "version_mismatch", message: "upgrade required" },
  { v: 1, type: "error", code: "rate_limited", message: "slow down" },
  { v: 1, type: "error", code: "room_closed", message: "credential rotated" },
];

describe("parseMessage round-trips", () => {
  it.each(samples.map((message) => [describeSample(message), message] as const))(
    "round-trips %s",
    (_label, message) => {
      const result = parseMessage(serializeMessage(message));
      expect(result).toEqual({ ok: true, message });
    },
  );

  it("covers every message type in the catalog", () => {
    const covered = new Set<string>(samples.map((m) => m.type));
    expect(covered).toEqual(new Set(MESSAGE_TYPES));
  });
});

describe("parseMessage rejections", () => {
  it("rejects non-text frames", () => {
    const result = parseMessage(new ArrayBuffer(8));
    expect(result).toEqual({ ok: false, error: { code: "not_text" } });
  });

  it("rejects invalid JSON", () => {
    const result = parseMessage("{nope");
    expect(result).toEqual({ ok: false, error: { code: "invalid_json" } });
  });

  it("rejects valid JSON that is not an object", () => {
    expect(parseMessage('"just a string"')).toEqual({
      ok: false,
      error: { code: "invalid_json" },
    });
    expect(parseMessage("[1,2]")).toEqual({ ok: false, error: { code: "invalid_json" } });
  });

  it("rejects a missing version", () => {
    const result = parseMessage(JSON.stringify({ type: "interrupt" }));
    expect(result).toEqual({
      ok: false,
      error: { code: "version_mismatch", received: undefined },
    });
  });

  it("rejects a wrong version", () => {
    const result = parseMessage(JSON.stringify({ v: 2, type: "interrupt" }));
    expect(result).toEqual({ ok: false, error: { code: "version_mismatch", received: 2 } });
  });

  it("rejects an unknown type", () => {
    const result = parseMessage(JSON.stringify({ v: 1, type: "chat_device_register" }));
    expect(result).toEqual({
      ok: false,
      error: { code: "unknown_type", received: "chat_device_register" },
    });
  });

  it("rejects a non-string type", () => {
    const result = parseMessage(JSON.stringify({ v: 1, type: 42 }));
    expect(result).toEqual({ ok: false, error: { code: "unknown_type", received: 42 } });
  });

  it("rejects a known type with a malformed payload", () => {
    const missingText = parseMessage(JSON.stringify({ v: 1, type: "user_message" }));
    expect(missingText).toEqual({
      ok: false,
      error: { code: "malformed", type: "user_message" },
    });

    const badEvent = parseMessage(
      JSON.stringify({ v: 1, type: "agent_event", event: { type: "message_update" } }),
    );
    expect(badEvent).toEqual({ ok: false, error: { code: "malformed", type: "agent_event" } });

    const badRole = parseMessage(JSON.stringify({ v: 1, type: "peer_joined", role: "tablet" }));
    expect(badRole).toEqual({ ok: false, error: { code: "malformed", type: "peer_joined" } });

    const badCode = parseMessage(
      JSON.stringify({ v: 1, type: "error", code: "nonsense", message: "x" }),
    );
    expect(badCode).toEqual({ ok: false, error: { code: "malformed", type: "error" } });
  });

  it("rejects oversized frames", () => {
    const message: DispatchMessage = {
      v: 1,
      type: "user_message",
      text: "x".repeat(MAX_MESSAGE_BYTES),
    };
    const result = parseMessage(serializeMessage(message));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("oversized");
    }
  });

  it("measures size in UTF-8 bytes, not UTF-16 length", () => {
    // "€" is 1 UTF-16 code unit but 3 UTF-8 bytes: the string is shorter than
    // MAX_MESSAGE_BYTES in .length yet over it in bytes.
    const text = "€".repeat(Math.ceil(MAX_MESSAGE_BYTES / 3));
    const frame = serializeMessage({ v: 1, type: "user_message", text });
    expect(frame.length).toBeLessThan(MAX_MESSAGE_BYTES);
    const result = parseMessage(frame);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("oversized");
    }
  });
});

describe("utf8ByteLength", () => {
  it("counts ascii, multi-byte, and astral characters", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("𝄞")).toBe(4);
    expect(utf8ByteLength("a€𝄞")).toBe(8);
  });
});

describe("protocol constants", () => {
  it("pins the protocol version at 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("derives the type set from the union schema", () => {
    expect(MESSAGE_TYPES.has("user_message")).toBe(true);
    expect(MESSAGE_TYPES.has("agent_event")).toBe(true);
    // Legacy v0 types must be gone.
    expect(MESSAGE_TYPES.has("chat_device_register")).toBe(false);
    expect(MESSAGE_TYPES.size).toBe(11);
  });
});

function describeSample(message: DispatchMessage): string {
  return message.type === "agent_event" ? `agent_event/${message.event.type}` : message.type;
}
