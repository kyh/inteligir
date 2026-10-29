// The account's socket: a hint that the library moved, never its state, which a pull carries. A
// browser's socket carries no header, so it opens with a short-lived ticket an authenticated `/v1`
// call minted (`account.socketTicket`), in the query string the Worker's logs redact. Every frame
// is JSON; one of a type this build does not know is no frame, so a newer cell can add types.

import { z } from "zod";

import { idSchema, seqSchema } from "./library-wire";

export const V1_SOCKET_PATH = "/v1/socket";
export const SOCKET_TICKET_PARAM = "ticket";

// the library committed a write: a replica behind `head` pulls
const libraryMovedFrameSchema = z.object({ head: seqSchema, type: z.literal("library") });

// the built-in agent's turn moved: an event the cell stored, which the thread's next pull carries
// too, or a preview of the agent's message as it is written, which no pull ever carries. The event
// is Managed Agents' own, kept raw, so a type this build never heard of is one it skips
const threadFrameSchema = z.object({
  event: z.json(),
  preview: z.boolean(),
  threadId: idSchema,
  type: z.literal("thread"),
});

export const librarySocketFrameSchema = z.discriminatedUnion("type", [
  libraryMovedFrameSchema,
  threadFrameSchema,
]);
export type LibrarySocketFrame = z.infer<typeof librarySocketFrameSchema>;
