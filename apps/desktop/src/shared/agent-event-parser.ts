// ---------------------------------------------------------------------------
// Parse raw pi-agent-core events into typed AppAgentEvent at the IPC boundary.
// Pure function — no Electron, no sidecar dependency. Testable in plain Node.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { AppAgentEvent } from "./agent-events";
import { extractText, isRecord } from "./ipc";

// ---------------------------------------------------------------------------
// Per-event-type Zod schemas (only the 7 types the app cares about)
// ---------------------------------------------------------------------------

const AgentStartSchema = z.object({ type: z.literal("agent_start") });
const AgentEndSchema = z.object({ type: z.literal("agent_end") });

const MessageStartSchema = z.object({
  type: z.literal("message_start"),
  message: z.object({ role: z.string() }),
});

const MessageUpdateSchema = z.object({
  type: z.literal("message_update"),
  assistantMessageEvent: z.object({
    type: z.string(),
    delta: z.string().optional(),
  }),
});

const MessageEndSchema = z.object({
  type: z.literal("message_end"),
  message: z.object({
    role: z.string(),
    content: z.array(z.unknown()).default([]),
  }),
  stopReason: z.string().optional(),
});

const ToolExecutionStartSchema = z.object({
  type: z.literal("tool_execution_start"),
  toolCallId: z.string(),
  toolName: z.string(),
});

const ToolExecutionEndSchema = z.object({
  type: z.literal("tool_execution_end"),
  toolCallId: z.string(),
  isError: z.boolean(),
  result: z.unknown(),
});

// ---------------------------------------------------------------------------
// Sidecar IPC message wrapper
// ---------------------------------------------------------------------------

export const SidecarMessageSchema = z.object({
  type: z.literal("agent-event"),
  event: z.unknown(),
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
  if (!isRecord(raw) || typeof raw.type !== "string") return null;

  switch (raw.type) {
    case "agent_start": {
      const r = AgentStartSchema.safeParse(raw);
      return r.success ? { type: "agent_start" } : null;
    }

    case "agent_end": {
      const r = AgentEndSchema.safeParse(raw);
      return r.success ? { type: "agent_end" } : null;
    }

    case "message_start": {
      const r = MessageStartSchema.safeParse(raw);
      if (!r.success) return null;
      const role = r.data.message.role;
      if (role !== "assistant" && role !== "user") return null;
      return { type: "message_start", role };
    }

    case "message_update": {
      const r = MessageUpdateSchema.safeParse(raw);
      if (!r.success) return null;
      const ame = r.data.assistantMessageEvent;
      // Only text_delta events carry meaningful content for the renderer
      if (ame.type !== "text_delta" || !ame.delta) return null;
      return { type: "message_update", delta: ame.delta };
    }

    case "message_end": {
      const r = MessageEndSchema.safeParse(raw);
      if (!r.success) return null;
      return {
        type: "message_end",
        role: r.data.message.role,
        text: extractText(r.data.message),
        stopReason: r.data.stopReason,
      };
    }

    case "tool_execution_start": {
      const r = ToolExecutionStartSchema.safeParse(raw);
      if (!r.success) return null;
      return {
        type: "tool_execution_start",
        toolCallId: r.data.toolCallId,
        toolName: r.data.toolName,
      };
    }

    case "tool_execution_end": {
      const r = ToolExecutionEndSchema.safeParse(raw);
      if (!r.success) return null;
      return {
        type: "tool_execution_end",
        toolCallId: r.data.toolCallId,
        isError: r.data.isError,
        resultText: extractText(r.data.result),
      };
    }

    default:
      return null;
  }
}
