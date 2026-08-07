// ---------------------------------------------------------------------------
// Parse raw pi-agent-core events into typed AppAgentEvent at the IPC boundary.
// Pure — no platform dependency, so it is testable anywhere this package
// loads.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { AppAgentEvent } from "./agent-events";
import { extractText, isRecord } from "./wire-helpers";

// ---------------------------------------------------------------------------
// Per-event-type schemas (only the 8 types the app cares about)
// ---------------------------------------------------------------------------

const MessageStartSchema = Type.Object({
  message: Type.Object({ role: Type.String() }),
});

const MessageUpdateSchema = Type.Object({
  assistantMessageEvent: Type.Object({
    type: Type.String(),
    delta: Type.Optional(Type.String()),
  }),
});

const MessageEndSchema = Type.Object({
  // pi-coding-agent puts stopReason and errorMessage on the *message* object,
  // not at the top level of the event. Reading them from the top level
  // silently swallows every provider error as "unknown stop reason."
  message: Type.Object({
    role: Type.String(),
    content: Type.Optional(Type.Array(Type.Unknown())),
    stopReason: Type.Optional(Type.String()),
    errorMessage: Type.Optional(Type.String()),
  }),
});

const ToolExecutionStartSchema = Type.Object({
  toolCallId: Type.String(),
  toolName: Type.String(),
  args: Type.Optional(Type.Unknown()),
});

const ToolExecutionEndSchema = Type.Object({
  toolCallId: Type.String(),
  isError: Type.Boolean(),
  result: Type.Unknown(),
});

const QueueUpdateSchema = Type.Object({
  steering: Type.Optional(Type.Array(Type.String())),
  followUp: Type.Optional(Type.Array(Type.String())),
});

// ---------------------------------------------------------------------------
// Main parser — unknown → AppAgentEvent | null
// ---------------------------------------------------------------------------

/**
 * Parse a raw pi-agent-core event into a clean AppAgentEvent.
 * Returns null for events the app doesn't care about or malformed data.
 * Never throws.
 */
export function parseAgentEvent(raw: unknown): AppAgentEvent | null {
  if (!isRecord(raw) || typeof raw["type"] !== "string") return null;

  switch (raw["type"]) {
    case "agent_start":
      return { type: "agent_start" };

    case "agent_end":
      return { type: "agent_end" };

    case "message_start": {
      if (!Value.Check(MessageStartSchema, raw)) return null;
      const role = raw.message.role;
      if (role !== "assistant" && role !== "user") return null;
      return { type: "message_start", role };
    }

    case "message_update": {
      if (!Value.Check(MessageUpdateSchema, raw)) return null;
      const ame = raw.assistantMessageEvent;
      // Only text_delta events carry meaningful content for a client
      if (ame.type !== "text_delta" || !ame.delta) return null;
      return { type: "message_update", delta: ame.delta };
    }

    case "message_end": {
      if (!Value.Check(MessageEndSchema, raw)) return null;
      return {
        type: "message_end",
        role: raw.message.role,
        text: extractText(raw.message),
        // Conditional spreads keep optional fields absent (not undefined) so
        // AppAgentEvent stays structurally a wire AgentEvent projection.
        ...(raw.message.stopReason === undefined ? {} : { stopReason: raw.message.stopReason }),
        ...(raw.message.errorMessage === undefined
          ? {}
          : { errorMessage: raw.message.errorMessage }),
      };
    }

    case "tool_execution_start": {
      if (!Value.Check(ToolExecutionStartSchema, raw)) return null;
      return {
        type: "tool_execution_start",
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        args: raw.args,
      };
    }

    case "tool_execution_end": {
      if (!Value.Check(ToolExecutionEndSchema, raw)) return null;
      return {
        type: "tool_execution_end",
        toolCallId: raw.toolCallId,
        isError: raw.isError,
        resultText: extractText(raw.result),
      };
    }

    case "queue_update": {
      if (!Value.Check(QueueUpdateSchema, raw)) return null;
      return {
        type: "queue_update",
        steering: [...(raw.steering ?? [])],
        followUp: [...(raw.followUp ?? [])],
      };
    }

    default:
      return null;
  }
}
