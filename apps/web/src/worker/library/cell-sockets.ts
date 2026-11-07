// The account's live sockets, held by its library cell under the hibernation API
// (https://developers.cloudflare.com/durable-objects/best-practices/websockets/): each accepted
// with `ctx.acceptWebSocket` under its holder's tag, a ping answered by the runtime without waking
// the cell, and every frame sent to the sockets `getWebSockets()` lists that are still open.
// Nothing the cell needs later lives in memory, so a hibernated or evicted cell finds every socket
// again.

import { SOCKET_REVOKED_CLOSE_CODE } from "@repo/contract/cloud/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import { z } from "zod";

import { credentialIdSchema } from "./library-principal";

// who a socket answers to: a device by its credential, or a browser tab by its session; the
// Worker verifies it and stamps it on the upgrade, over any copy the request carried, and the
// ticket it opens with names the same holder (`./socket-ticket`)
const HOLDER_KINDS = ["device", "session"] as const;
export const holderSchema = z.strictObject({
  id: credentialIdSchema,
  kind: z.enum(HOLDER_KINDS),
});
export type SocketHolder = z.infer<typeof holderSchema>;

// the cell's own door for an upgrade, which only `./socket-routes` forwards to
export const CELL_SOCKET_PATH = "/socket";

export const holderHeaderValue = (holder: SocketHolder): string => `${holder.kind}:${holder.id}`;

export const holderFromHeader = (value: string | null): SocketHolder | null => {
  const colon = value?.indexOf(":") ?? -1;
  if (value === null || colon === -1) {
    return null;
  }
  const holder = holderSchema.safeParse({
    id: value.slice(colon + 1),
    kind: value.slice(0, colon),
  });
  return holder.success ? holder.data : null;
};

// a tag is at most 256 characters, and a socket holds at most 10
const holderTag = (holder: SocketHolder): string => holderHeaderValue(holder);

export const acceptSocket = (ctx: DurableObjectState, holder: SocketHolder): Response => {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  ctx.acceptWebSocket(server, [holderTag(holder)]);
  return new Response(null, { status: 101, webSocket: client });
};

export const socketHolder = (ctx: DurableObjectState, socket: WebSocket): SocketHolder | null =>
  holderFromHeader(ctx.getTags(socket)[0] ?? null);

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

// a frame for every socket of the account's: the library's new head, a turn's event
export const tellSockets = (ctx: DurableObjectState, frame: LibrarySocketFrame): void => {
  sendEach(ctx.getWebSockets(), frame);
};

// the library committed a write
export const pingLibraryMoved = (ctx: DurableObjectState, head: number): void => {
  tellSockets(ctx, { head, type: "library" });
};

// a credential check on the next request does not reach a socket that already has one
export const severHolder = (ctx: DurableObjectState, holder: SocketHolder): void => {
  closeEach(ctx.getWebSockets(holderTag(holder)), SOCKET_REVOKED_CLOSE_CODE, "signed out");
};

export const closeEverySocket = (ctx: DurableObjectState): void => {
  closeEach(ctx.getWebSockets(), 1001, "account deleted");
};
