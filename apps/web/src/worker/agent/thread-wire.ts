// What a conversation's object (`./agent-thread`) and its account's cell (`../library/library-do`)
// say to each other, each way by Durable Object RPC, parsed at the side that receives it. The
// thread asks the cell before every model call (`agentReserve`), has it run every tool call
// (`agentTool`), shows the reply as it is written (`agentPreview`), and pushes what the turn did
// (`agentPush`), each push by the thread's own sequence, so one sent again lands once. The cell
// refuses a thread it does not hold, which purges itself, and a turn that is not open, whose call
// lands nothing.

import { agentEventSchema } from "@repo/contract/cloud/library/agent-events";
import { z } from "zod";

const idSchema = z.string().min(1).max(128);
const turnSchema = z.number().int().positive();
const count = z.number().int().nonnegative();

// why the cell lands nothing of a call: it holds no such thread, or that turn is not open
type CellRefusal = "unknown-thread" | "turn-closed";

export type CellAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: CellRefusal };

// what the thread knows of a call before it sends it, which the cell prices as the cache will
// likely bill it: the body's tokens at most, the frozen system's and tools', and the previous
// call's prompt and when it ended
const callEstimateSchema = z.strictObject({
  frozenTokens: count,
  previous: z.strictObject({ endedAt: count, promptTokens: count }).nullable(),
  promptTokens: count,
});
export type CallEstimate = z.infer<typeof callEstimateSchema>;

export const reserveRequestSchema = z.strictObject({
  callId: z.string().min(1).max(256),
  estimate: callEstimateSchema,
  // the cap a step sent again after a cut or a failure keeps, so its bytes are those it was first
  // sent with; null for a step's first call
  resend: z.number().int().positive().nullable(),
  threadId: idSchema,
  turn: turnSchema,
});
export type ReserveRequest = z.infer<typeof reserveRequestSchema>;

// the call's output cap, or no call: what the turn and the day have left buys too little
export type Reservation =
  | { readonly kind: "granted"; readonly maxTokens: number }
  | { readonly kind: "refused" };

export const toolRequestSchema = z.strictObject({
  input: z.json(),
  name: z.string().min(1).max(128),
  threadId: idSchema,
  toolUseId: idSchema,
  turn: turnSchema,
});
export type ToolRequest = z.infer<typeof toolRequestSchema>;

export interface ToolAnswer {
  readonly content: string;
  readonly isError: boolean;
}

// what one model call cost: its usage as the API reported it, priced by the cell; a call cut short
// reports none, and is booked at what it reserved; one the API refused before it ran cost nothing
const callEntrySchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    callId: z.string().min(1).max(256),
    kind: z.literal("call"),
    model: z.string().min(1).max(128),
    outcome: z.literal("billed"),
    usage: z.json(),
  }),
  z.strictObject({
    callId: z.string().min(1).max(256),
    kind: z.literal("call"),
    outcome: z.enum(["cut", "free"]),
  }),
]);

const eventEntrySchema = z.strictObject({ event: agentEventSchema, kind: z.literal("event") });

export const pushEntrySchema = z.union([eventEntrySchema, callEntrySchema]);
export type PushEntry = z.infer<typeof pushEntrySchema>;

export const pushRequestSchema = z.strictObject({
  entries: z.array(pushEntrySchema).max(1000),
  seq: z.number().int().positive(),
  threadId: idSchema,
  turn: turnSchema,
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const previewRequestSchema = z.strictObject({
  text: z.string().max(1_000_000),
  threadId: idSchema,
  turn: turnSchema,
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

// ---- what the cell asks of the thread ----

const textBlockSchema = z.strictObject({ text: z.string(), type: z.literal("text") });

// a turn handed to its thread: the person's message as the text blocks it sends, and the filing
// rules the library keeps, or null; `opId` is the cell's own, so a delivery sent again lands once
export const deliveryRequestSchema = z.strictObject({
  content: z.array(textBlockSchema).min(1),
  opId: z.string().min(1).max(256),
  rules: z.string().nullable(),
  threadId: idSchema,
  turn: turnSchema,
});
export type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;

export const respondRequestSchema = z.strictObject({
  approved: z.boolean(),
  reason: z.string().max(1000).nullable(),
  toolUseId: idSchema,
});
export type RespondRequest = z.infer<typeof respondRequestSchema>;

// where a thread stands, for the cell's watch and the suites
export interface ThreadInspection {
  // the turn it works on, and where that stands
  readonly turn: number | null;
  readonly status: "idle" | "running" | "awaiting_approval";
  // whether this instance runs its work now
  readonly driving: boolean;
  readonly outbox: number;
}
