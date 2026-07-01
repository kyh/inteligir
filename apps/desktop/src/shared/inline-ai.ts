import { Type } from "@sinclair/typebox";

// Inline-AI generation IPC. The renderer builds the full prompt (action +
// selected/context text) and a requestId to correlate the streamed deltas, and
// gets back the assistant's final text.
export const AiGenerateParamsSchema = Type.Object(
  { prompt: Type.String({ minLength: 1 }), requestId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export type AiGenerateResult = { ok: true; text: string } | { ok: false; error: string };
