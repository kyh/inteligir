// The account's socket: a hint that the library moved, never its state, which a pull carries, and
// the built-in agent's turn as it moves. A browser's socket carries no header, so it opens with a
// short-lived ticket an authenticated `/v1` call minted (`account.socketTicket`), in the query
// string the Worker's logs redact. Every frame is JSON; one of a type this build does not know is
// no frame, so a newer cell can add types.

import { z } from "zod";

import { idSchema, seqSchema } from "./library-wire";

export const V1_SOCKET_PATH = "/v1/socket";
export const SOCKET_TICKET_PARAM = "ticket";

// the cell answers the literal ping by auto-response, without waking from hibernation
export const SOCKET_KEEPALIVE_PING = "ping";
export const SOCKET_KEEPALIVE_PONG = "pong";

// RFC 6455's policy violation: the cell closes a revoked credential's sockets with it. No client
// reads it: a closed socket dials again, its ticket is refused, and the refusal of the replica's
// next pass, at its minute's check-in at the latest, is what ends the session
export const SOCKET_REVOKED_CLOSE_CODE = 1008;

// the library committed a write: a replica behind `head` pulls
const libraryMovedFrameSchema = z.object({ head: seqSchema, type: z.literal("library") });

// the most ids a moved frame names in one list; past it the list says "all"
export const MOVED_IDS_MAX = 200;

// what one landed write moved, so a client refetches only what it shows of that: each item at the
// sequence it now holds, whether any folder moved, and which threads did; "all" when the write
// moved more than a frame names. No client bounds the lists, so a cell may raise the cap
const movedFrameSchema = z.object({
  folders: z.boolean(),
  items: z.union([z.literal("all"), z.array(z.object({ id: idSchema, seq: seqSchema }))]),
  threads: z.union([z.literal("all"), z.array(idSchema)]),
  type: z.literal("moved"),
});
export type MovedFrame = z.infer<typeof movedFrameSchema>;

// the built-in agent's turn moved: an event the cell stored, which the thread's next pull carries
// too, or a preview of the agent's message as it is written (`agent.preview`), which no pull ever
// carries. The event is one of `./agent-events`' union, read as JSON, so one this build cannot
// parse is one it skips
const threadFrameSchema = z.object({
  event: z.json(),
  preview: z.boolean(),
  threadId: idSchema,
  type: z.literal("thread"),
});

export const librarySocketFrameSchema = z.discriminatedUnion("type", [
  libraryMovedFrameSchema,
  movedFrameSchema,
  threadFrameSchema,
]);
export type LibrarySocketFrame = z.infer<typeof librarySocketFrameSchema>;
