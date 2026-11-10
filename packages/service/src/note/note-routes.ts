// An item's note, `/v1/notes/<itemId>`, upgraded in the Worker and handed to the note's object. It
// opens on the account socket's ticket, since a browser's socket carries no header; the account's
// cell says how the session's socket opens (writable, read-only for an item in Deleted, or not at
// all), and the Worker forwards a fresh upgrade carrying only what it verified, so nothing the client
// sent names a session or a mode. The holder's standing is checked before the cell is asked and again
// after the upgrade, as the account's socket checks it, so a session's end closes its note sockets
// too (`../library/library-do`'s `sever`).

import { idSchema } from "@repo/contract/library/library-wire";
import {
  NOTE_SOCKET,
  notePath,
  SOCKET_TICKET_PARAM,
  V1_NOTES_PATH,
} from "@repo/contract/library/library-socket";

import { createDb } from "@repo/db/d1/client";
import { libraryCell } from "../library/library-cell";
import { holderStands, isUpgrade, NOT_AN_UPGRADE, severSockets } from "../library/socket-routes";
import { readSocketTicket } from "../library/socket-ticket";
import { plainText } from "../plain-http";
import { noteStub } from "./note-stub";
import { NOTE_HOLDER_HEADER, NOTE_MODE_HEADER } from "./note-wire";

// the y-partyserver connection id a client names, the one part of its address the note reads
const CONNECTION_PARAM = "_pk";

const itemIdOf = (pathname: string): string | null => {
  const parsed = idSchema.safeParse(pathname.slice(V1_NOTES_PATH.length + 1));
  return parsed.success ? parsed.data : null;
};

// A note the library does not hold answers a socket closed at once with a code, since a browser
// shows a failed upgrade's status to no page and would dial again for good.
const closedAsMissing = (): Response => {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.close(NOTE_SOCKET.missingCode, "This note isn't in your library.");
  return new Response(null, { status: 101, webSocket: client });
};

export const handleNoteSocket = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (!isUpgrade(request)) {
    return plainText(400, NOT_AN_UPGRADE);
  }
  const itemId = itemIdOf(url.pathname);
  if (itemId === null) {
    return plainText(404, "not found");
  }
  const now = Date.now();
  const ticket = url.searchParams.get(SOCKET_TICKET_PARAM);
  const claim =
    ticket === null ? null : await readSocketTicket(env.BETTER_AUTH_SECRET, ticket, now);
  const db = createDb(env.DB);
  if (claim === null || !(await holderStands(db, claim.accountId, claim.holder, now))) {
    return plainText(401, "You're signed out. Sign in again.");
  }
  const { accountId, holder } = claim;
  const opening = await libraryCell(ctx.exports, accountId).openNote(holder.id, itemId);
  if (opening === "missing") {
    return closedAsMissing();
  }
  const forward = new URL(`https://note${notePath(itemId)}`);
  const connection = url.searchParams.get(CONNECTION_PARAM);
  if (connection !== null) {
    forward.searchParams.set(CONNECTION_PARAM, connection);
  }
  const headers = new Headers({ upgrade: "websocket" });
  headers.set(NOTE_HOLDER_HEADER, holder.id);
  headers.set(NOTE_MODE_HEADER, opening);
  const opened = await noteStub(ctx.exports, { accountId, itemId }).fetch(
    new Request(forward, { headers }),
  );
  // a sever closes only the sockets already accepted, so an end between the check and the accept is
  // seen here, or its sever sees this socket
  if (opened.status === 101 && !(await holderStands(db, accountId, holder, now))) {
    await severSockets(ctx.exports, accountId, holder);
  }
  return opened;
};
