// What the shell answers when it asks the OS to show a folder or open a file of its own (the data
// folder, the server's log): only whether the OS took it.

import { z } from "zod";

export const pathActionResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type PathActionResult = z.infer<typeof pathActionResultSchema>;
