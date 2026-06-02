import { z } from "zod";

export const dispatchDirection = z.enum(["to_device", "to_mobile"]);
export type DispatchDirection = z.infer<typeof dispatchDirection>;

export const mobileCommandType = z.enum(["user_message", "steer", "interrupt"]);
export type MobileCommandType = z.infer<typeof mobileCommandType>;

export const agentEventType = z.enum([
  "agent_start",
  "agent_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
]);
export type AgentEventType = z.infer<typeof agentEventType>;

export const EPHEMERAL_EVENT_TYPES = new Set<string>([
  "message_update",
  "message_start",
]);

export const dispatchEnvelope = z.object({
  direction: dispatchDirection,
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type DispatchEnvelope = z.infer<typeof dispatchEnvelope>;

export function parseMessage(data: string): DispatchEnvelope | null {
  try {
    const result = dispatchEnvelope.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function encodeMessage(
  direction: DispatchDirection,
  type: string,
  payload: Record<string, unknown> = {},
): string {
  return JSON.stringify({ direction, type, payload });
}
