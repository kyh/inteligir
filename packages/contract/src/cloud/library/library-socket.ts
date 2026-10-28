// The account's socket: a hint that the library moved, never its state, which a pull carries. A
// browser's socket carries no header, so it opens with a short-lived ticket an authenticated `/v1`
// call minted (`account.socketTicket`), in the query string the Worker's logs redact. Every frame
// is JSON; one of a type this build does not know is no frame, so a newer cell can add types.

import { z } from "zod";

import { seqSchema } from "./library-wire";

export const V1_SOCKET_PATH = "/v1/socket";
export const SOCKET_TICKET_PARAM = "ticket";

// the library committed a write: a replica behind `head` pulls
const libraryMovedFrameSchema = z.object({ head: seqSchema, type: z.literal("library") });

export const librarySocketFrameSchema = z.discriminatedUnion("type", [libraryMovedFrameSchema]);
export type LibrarySocketFrame = z.infer<typeof librarySocketFrameSchema>;
