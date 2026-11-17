// An item's note, edited live: a socket of its own at `/v1/notes/<itemId>`, carrying y-sync to and
// from the note and the words each end says beside it. A browser's socket carries no header, so it
// opens with a short-lived ticket an authenticated `/v1` call minted (`account.socketTicket`), in
// the query string.

export const V1_NOTES_PATH = "/v1/notes";
const SOCKET_TICKET_PARAM = "ticket";

// a socket's address at `path` on the cloud's origin, its scheme the origin's own made a socket's
export const socketUrl = (origin: string, path: string, ticket: string): string => {
  const scheme = origin.startsWith("https:") ? "wss:" : "ws:";
  const rest = origin.replace(/^https?:/u, "");
  return `${scheme}${rest}${path}?${SOCKET_TICKET_PARAM}=${encodeURIComponent(ticket)}`;
};

export const notePath = (itemId: string): string => `${V1_NOTES_PATH}/${itemId}`;

// What a note's socket says beside y-sync: the words each end sends as text, the ping its object
// answers without waking among them, and the codes it closes with.
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
  // the item went into Deleted or came back, or its note takes edits again: a client dials again
  reopenCode: 4000,
  // RFC 6455's policy violation: the session that opened the socket ended
  revokedCode: 1008,
} as const;

// a word as it crosses a note's socket, in y-partyserver's frame for a message beside y-sync
export const noteWordFrame = (word: string): string => `__YPS:${word}`;
