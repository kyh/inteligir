import { z } from "zod";

const TOOL_RESULT_SUMMARY_MAX = 2000;

const toolUseIdSchema = z.string().min(1).max(128);
const toolNameSchema = z.string().min(1).max(128);

export const TURN_END_REASONS = [
  "done",
  "cancelled",
  "allowance",
  "budget",
  "steps",
  "failed",
  "unavailable",
] as const;

export type TurnEndReason = (typeof TURN_END_REASONS)[number];

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ text: z.string(), type: z.literal("user.message") }),
  z.object({ text: z.string(), type: z.literal("agent.message") }),
  z.object({ text: z.string(), type: z.literal("agent.progress") }),
  z.object({
    input: z.json(),
    name: toolNameSchema,
    toolUseId: toolUseIdSchema,
    type: z.literal("agent.tool_use"),
  }),
  z.object({
    isError: z.boolean(),
    summary: z.string().max(TOOL_RESULT_SUMMARY_MAX),
    toolUseId: toolUseIdSchema,
    type: z.literal("agent.tool_result"),
  }),
  z.object({
    reason: z.enum(TURN_END_REASONS),
    turn: z.number().int().positive(),
    type: z.literal("turn.ended"),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
