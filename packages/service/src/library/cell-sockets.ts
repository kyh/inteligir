// The account's live sockets, held by its library cell under the hibernation API
// (https://developers.cloudflare.com/durable-objects/best-practices/websockets/): each accepted
// with `ctx.acceptWebSocket` under its session's id, a ping answered by the runtime without waking
// the cell, and every frame sent to the sockets `getWebSockets()` lists that are still open.
// Nothing the cell needs later lives in memory, so a hibernated or evicted cell finds every socket
// again.

import { SOCKET_REVOKED_CLOSE_CODE } from "@repo/contract/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";

// a socket answers to a session, whichever door it came by: the ticket it opened with names it
// (`./socket-ticket`), and here the Worker names it on the upgrade it hands the cell
// (`./socket-routes`)
export const SOCKET_HOLDER_HEADER = "x-library-socket-holder";

// tagged with its session's id, which a tag's 256 characters hold
export const acceptSocket = (ctx: DurableObjectState, sessionId: string): Response => {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  ctx.acceptWebSocket(server, [sessionId]);
  return new Response(null, { status: 101, webSocket: client });
};

// a closing socket still lists until it closes, and one torn down between the listing and the send
// throws: neither keeps the frame from the rest
const sendEach = (sockets: readonly WebSocket[], frame: LibrarySocketFrame): void => {
  const body = JSON.stringify(frame);
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    try {
      socket.send(body);
    } catch {
      // torn down after the readyState read; its close event follows
    }
  }
};

const closeEach = (sockets: readonly WebSocket[], code: number, reason: string): void => {
  for (const socket of sockets) {
    try {
      socket.close(code, reason);
    } catch {
      // already closing
    }
  }
};

// a frame for every socket of the account's: what a write moved, a turn's event
export const tellSockets = (ctx: DurableObjectState, frame: LibrarySocketFrame): void => {
  sendEach(ctx.getWebSockets(), frame);
};

// a credential check on the next request does not reach a socket that already has one
export const severHolder = (ctx: DurableObjectState, sessionId: string): void => {
  closeEach(ctx.getWebSockets(sessionId), SOCKET_REVOKED_CLOSE_CODE, "signed out");
};

export const closeEverySocket = (ctx: DurableObjectState): void => {
  closeEach(ctx.getWebSockets(), 1001, "account deleted");
};
