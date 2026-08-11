// ---------------------------------------------------------------------------
// App-level agent event types — parsed from raw pi events in the host, and
// consumed by the workspace exactly as they arrive.
// ---------------------------------------------------------------------------

export type AppAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "message_start"; role: "assistant" | "user" }
  | { type: "message_update"; delta: string }
  | {
      type: "message_end";
      role: string;
      text: string;
      stopReason?: string;
      /** Human-readable error message when stopReason === "error". */
      errorMessage?: string;
    }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_end"; toolCallId: string; isError: boolean; resultText: string }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  /** Synthetic. Main emits this when a turn ends without any assistant text,
   * tool call, or pi-emitted error event — almost always an upstream/auth
   * failure swallowed silently. Renderer renders a single error bubble. */
  | { type: "turn_error"; kind: "auth" | "unknown"; reason: string };
