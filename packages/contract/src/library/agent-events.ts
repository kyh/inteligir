// What a conversation with the built-in agent is made of, as every device reads it: the events a
// thread's rows carry (`threadEventRowSchema`'s `event`, its `type` beside it). The union is ours,
// never a model vendor's, so every device reads one shape whatever the agent runs on. A thread's
// object pushes these to its account's cell, which stores each once; the person's message that
// opens a turn is the cell's own. A reader skips an event its build cannot parse, so a newer cell
// may add types.

import { z } from "zod";

import { agentViewContextSchema } from "./library-wire";

// how much of a tool's result a stored event carries: the agent reads the whole of it, and a
// thread's event row never carries a page
export const TOOL_RESULT_SUMMARY_MAX = 2000;

const instant = z.number().int().nonnegative();
const toolUseIdSchema = z.string().min(1).max(128);
const toolNameSchema = z.string().min(1).max(128);

// why a turn ended: Claude ended it; the person stopped it; it reached the steps one turn may take;
// Claude's reply ran out of room, refused, or outgrew the conversation's window; Claude could not
// be reached; or the request itself failed
const TURN_END_REASONS = [
  "done",
  "cancelled",
  "budget",
  "max_tokens",
  "refusal",
  "model_context_window_exceeded",
  "unavailable",
  "failed",
] as const;
export type TurnEndReason = (typeof TURN_END_REASONS)[number];

// who settled an approval: the person, its ten minutes running out, or the turn stopped
const APPROVAL_DECIDERS = ["person", "timeout", "cancel"] as const;

export const agentEventSchema = z.discriminatedUnion("type", [
  // what the person sent, and the screen they sent it from
  z.object({
    text: z.string(),
    type: z.literal("user.message"),
    viewContext: agentViewContextSchema.optional(),
  }),
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
  // a call that waits on the person until `until`, when it is denied
  z.object({
    input: z.json(),
    name: toolNameSchema,
    toolUseId: toolUseIdSchema,
    type: z.literal("approval.asked"),
    until: instant,
  }),
  z.object({
    by: z.enum(APPROVAL_DECIDERS),
    result: z.enum(["allow", "deny"]),
    toolUseId: toolUseIdSchema,
    type: z.literal("approval.answered"),
  }),
  z.object({
    // what stopped it, in a word a reader may show: a refusal's category
    detail: z.string().max(200).optional(),
    reason: z.enum(TURN_END_REASONS),
    turn: z.number().int().positive(),
    type: z.literal("turn.ended"),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
