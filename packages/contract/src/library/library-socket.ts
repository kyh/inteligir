// The account's socket: a hint of what the library moved, never its state, which a client reads
// again over `/v1`, and the reply the built-in agent is writing. A browser's socket carries no
// header, so it opens with a short-lived ticket an authenticated `/v1` call minted
// (`account.socketTicket`), in the query string the Worker's logs redact. Every frame is JSON; one of a type this build does not know is
// no frame, so a newer cell can add types.

import { z } from "zod";

import { idSchema, seqSchema } from "./library-wire";

export const V1_SOCKET_PATH = "/v1/socket";
export const SOCKET_TICKET_PARAM = "ticket";

// the cell answers the literal ping by auto-response, without waking from hibernation
export const SOCKET_KEEPALIVE_PING = "ping";
export const SOCKET_KEEPALIVE_PONG = "pong";

// RFC 6455's policy violation: the cell closes a revoked credential's sockets with it. No client
// reads it: a closed socket dials again, its ticket is refused, and the refusal of the client's
// next call is what ends the session
export const SOCKET_REVOKED_CLOSE_CODE = 1008;

// the most ids a moved frame names in one list; past it the list says "all"
export const MOVED_IDS_MAX = 200;

// An item's note, edited live: a socket of its own at `/v1/notes/<itemId>`, opened on the same
// ticket as the account's, carrying y-sync to and from the note's object.
export const V1_NOTES_PATH = "/v1/notes";

export const notePath = (itemId: string): string => `${V1_NOTES_PATH}/${itemId}`;

// What a note's socket says beside y-sync: the ping its object answers without waking, the words
// it sends as text, and the codes it closes with.
export const NOTE_SOCKET = {
  ping: "ping",
  pong: "pong",
  // the note is in Deleted: it takes no edit
  deleted: "deleted",
  // the note is past its size: it takes no more edit, from any device or the agent
  full: "full",
  // a frame past an update's size was refused, so this socket takes nothing more
  refused: "read-only",
  // asked by a client about to close, answered once every frame it sent is stored
  savedAsk: "saved?",
  saved: "saved",
  // the item is not in the library: a client stops dialing
  missingCode: 4404,
  // the item came back from Deleted, or its note takes edits again: a client dials again, writable
  reopenCode: 4000,
  // the session that opened the socket ended
  revokedCode: SOCKET_REVOKED_CLOSE_CODE,
} as const;

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

// the reply the built-in agent is writing in a thread, its text so far, which no read ever answers:
// a moved frame naming the thread lets it go, since by then the reply landed or the turn moved on
const previewFrameSchema = z.object({
  text: z.string(),
  threadId: idSchema,
  type: z.literal("preview"),
});

export const librarySocketFrameSchema = z.discriminatedUnion("type", [
  movedFrameSchema,
  previewFrameSchema,
]);
export type LibrarySocketFrame = z.infer<typeof librarySocketFrameSchema>;
