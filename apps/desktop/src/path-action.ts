// A vault entry the page asks the OS to show or open: the request names it vault-relative,
// the shell resolves and checks it, and the answer says only whether the OS took it.

import { z } from "zod";

export const pathActionRequestSchema = z.object({ path: z.string().min(1) }).strict();

export const pathActionResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type PathActionResult = z.infer<typeof pathActionResultSchema>;
