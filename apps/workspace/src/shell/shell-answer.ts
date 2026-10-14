// What a shell command that can be refused answers (src-tauri/src/answer.rs): done, with the state
// the page adopts when there is one, or the shell's refusal in its words. A refusal crosses as a
// value; a command that can fail only by a fault answers its value alone, and rejects.

import { z } from "zod";

const doneSchema = z.strictObject({ ok: z.literal(true) });
const refusedSchema = z.strictObject({ ok: z.literal(false), reason: z.string().min(1) });

// an answer that says only whether the shell did it
export const doneAnswerSchema = z.discriminatedUnion("ok", [doneSchema, refusedSchema]);
export type DoneAnswer = z.infer<typeof doneAnswerSchema>;

export const answerSchema = <State extends z.ZodType>(state: State) =>
  z.discriminatedUnion("ok", [doneSchema.extend({ state }), refusedSchema]);

export type BridgeAnswer<State> = z.infer<ReturnType<typeof answerSchema<z.ZodType<State>>>>;
