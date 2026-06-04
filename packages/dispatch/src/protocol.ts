import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const DispatchDirectionSchema = Type.Union([
  Type.Literal("to_device"),
  Type.Literal("to_mobile"),
]);
export type DispatchDirection = Static<typeof DispatchDirectionSchema>;

export const MobileCommandTypeSchema = Type.Union([
  Type.Literal("user_message"),
  Type.Literal("steer"),
  Type.Literal("interrupt"),
]);
export type MobileCommandType = Static<typeof MobileCommandTypeSchema>;

export const AgentEventTypeSchema = Type.Union([
  Type.Literal("agent_start"),
  Type.Literal("agent_end"),
  Type.Literal("message_start"),
  Type.Literal("message_update"),
  Type.Literal("message_end"),
  Type.Literal("tool_execution_start"),
  Type.Literal("tool_execution_end"),
]);
export type AgentEventType = Static<typeof AgentEventTypeSchema>;

export const EPHEMERAL_EVENT_TYPES = new Set<string>([
  "message_update",
  "message_start",
]);

export const DispatchEnvelopeSchema = Type.Object({
  direction: DispatchDirectionSchema,
  type: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
});
export type DispatchEnvelope = Static<typeof DispatchEnvelopeSchema>;

export function parseMessage(data: string): DispatchEnvelope | null {
  try {
    const parsed = JSON.parse(data);
    if (Value.Check(DispatchEnvelopeSchema, parsed)) {
      return parsed;
    }
    return null;
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
