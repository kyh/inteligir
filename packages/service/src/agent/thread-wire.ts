// What a conversation's object (`./agent-thread`) and its account's cell (`../library/library-do`)
// say to each other, each way by Durable Object RPC, parsed at the side that receives it. The
// thread has the cell run every tool call (`agentTool`), shows the reply as it is written
// (`agentPreview`), and pushes what the turn did (`agentPush`): its events. Each push goes by the
// thread's own sequence, so one sent
// again lands once, and every delivery says the last push the cell landed, so an object that
// started over on empty tables goes on past it. The cell refuses a thread it does not hold, which
// purges itself, and a turn that is not open, whose call lands nothing.

import { agentEventSchema } from "@repo/contract/library/agent-events";
import { z } from "zod";

const idSchema = z.string().min(1).max(128);
const turnSchema = z.number().int().positive();

// why the cell lands nothing of a call: it holds no such thread, or that turn is not open
type CellRefusal = "unknown-thread" | "turn-closed";

export type CellAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: CellRefusal };

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

export const pushRequestSchema = z.strictObject({
  events: z.array(agentEventSchema).max(1000),
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

// a turn handed to its thread: the person's message as the text blocks it sends, the filing rules
// the library keeps, or null, and the last push the cell landed of this thread; `opId` is the
// cell's own, so a delivery sent again lands once
export const deliveryRequestSchema = z.strictObject({
  content: z.array(textBlockSchema).min(1),
  opId: z.string().min(1).max(256),
  pushedThrough: z.number().int().nonnegative(),
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
