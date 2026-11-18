// What a conversation with the built-in agent is made of, as every device reads it: the events a
// thread's rows carry (`threadEventRowSchema`'s `event`, its `type` beside it). The union is ours,
// never the agent's runtime's, so every device reads one shape whatever the agent runs on. A
// reader skips an event its build cannot parse, so a newer cloud may add types.

import { z } from "zod";

// how much of a tool's result a stored event carries: the agent reads the whole of it, and a
// thread's event row never carries a page
const TOOL_RESULT_SUMMARY_MAX = 2000;

const toolUseIdSchema = z.string().min(1).max(128);
const toolNameSchema = z.string().min(1).max(128);

// why a turn ended: it finished; the person stopped it; the day's turns ran out, or the account's
// spend, or the steps one turn may take; it failed; or the model could not be reached
const TURN_END_REASONS = [
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
  // what the person sent; one sent while a turn runs joins it
  z.object({ text: z.string(), type: z.literal("user.message") }),
  // what the agent wrote back
  z.object({ text: z.string(), type: z.literal("agent.message") }),
  // a short note of what the agent found or does next, written before the tool call it introduces
  z.object({ text: z.string(), type: z.literal("agent.progress") }),
  z.object({
    input: z.json(),
    name: toolNameSchema,
    toolUseId: toolUseIdSchema,
    type: z.literal("agent.tool_use"),
  }),
  z.object({
    isError: z.boolean(),
    // the result's first characters
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
