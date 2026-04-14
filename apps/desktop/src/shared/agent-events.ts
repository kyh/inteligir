// ---------------------------------------------------------------------------
// App-level agent event types — parsed from raw pi-agent-core events at
// the main process boundary. Renderer consumes these directly.
// ---------------------------------------------------------------------------

export type AppAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "message_start"; role: "assistant" | "user" }
  | { type: "message_update"; delta: string }
  | { type: "message_end"; role: string; text: string; stopReason?: string }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; isError: boolean; resultText: string };
