// what the server and the desktop shell's main process say when main forks one of the server's
// node children for it. both ends parse every frame: each arrives as a structured clone, typed any.

import { z } from "zod";

const forkIdSchema = z.string().min(1);

export const forkRequestSchema = z
  .object({
    args: z.array(z.string()),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()),
    id: forkIdSchema,
    kind: z.literal("fork"),
    modulePath: z.string().min(1),
    serviceName: z.string().min(1),
  })
  .strict();
export type ForkRequest = z.infer<typeof forkRequestSchema>;

// "forked" transfers the server's end of a MessageChannel whose other end went to the child.
export const forkReplySchema = z.discriminatedUnion("kind", [
  z
    .object({ id: forkIdSchema, kind: z.literal("forked"), pid: z.number().int().positive() })
    .strict(),
  z.object({ id: forkIdSchema, kind: z.literal("fork-failed"), message: z.string() }).strict(),
  z.object({ code: z.number().int(), id: forkIdSchema, kind: z.literal("exited") }).strict(),
]);
export type ForkReply = z.infer<typeof forkReplySchema>;

// main's one frame to a forked child, transferring the child's end of that channel.
export const attachFrameSchema = z.object({ kind: z.literal("attach") }).strict();
export type AttachFrame = z.infer<typeof attachFrameSchema>;
