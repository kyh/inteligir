// The account's socket, `/v1/socket`, upgraded in the Worker and handed to the account's library
// cell, which keeps it. It opens with a ticket (`./socket-ticket`) on every client, since a
// browser's socket carries no header; the Worker names the cell from the account the ticket
// verified, and stamps its holder over any copy the request carried. The ticket goes no further.

import { SOCKET_TICKET_PARAM } from "@repo/contract/cloud/library/library-socket";
import { and, eq, gt, isNull } from "drizzle-orm";

import { createDb } from "../db/client";
import type { Db } from "../db/client";
import { device, session } from "../db/schema";
import { plainText } from "../plain-http";
import { holderHeaderValue, SOCKET_HOLDER_HEADER } from "./cell-sockets";
import type { SocketHolder } from "./cell-sockets";
import { libraryCell } from "./library-cell";
import { readSocketTicket } from "./socket-ticket";

const NOT_AN_UPGRADE = "This route only upgrades to a WebSocket.";

const isUpgrade = (request: Request): boolean =>
  request.method === "GET" && request.headers.get("upgrade")?.toLowerCase() === "websocket";

// the upgrade forwarded whole for its handshake headers, with the verified holder stamped
const forwardToCell = async (
  request: Request,
  ctx: ExecutionContext,
  accountId: string,
  holder: SocketHolder,
): Promise<Response> => {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(SOCKET_HOLDER_HEADER, holderHeaderValue(holder));
  return await libraryCell(ctx.exports, accountId).fetch(
    new Request("https://library-cell/socket", { headers }),
  );
};

// the ticket's credential still stands: a revocation since it was minted shuts the socket out
const holderStands = async (
  db: Db,
  accountId: string,
  holder: SocketHolder,
  now: number,
): Promise<boolean> => {
  if (holder.kind === "device") {
    const row = await db
      .select({ id: device.id })
      .from(device)
      .where(and(eq(device.id, holder.id), eq(device.userId, accountId), isNull(device.revokedAt)))
      .get();
    return row !== undefined;
  }
  const row = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, holder.id),
        eq(session.userId, accountId),
        gt(session.expiresAt, new Date(now)),
      ),
    )
    .get();
  return row !== undefined;
};

// the ticket in the query string, which the logs redact; the build floor does not apply, since a
// browser's socket cannot name its build and the ticket came from a call that met it
export const handleLibrarySocket = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (!isUpgrade(request)) {
    return plainText(400, NOT_AN_UPGRADE);
  }
  const now = Date.now();
  const ticket = url.searchParams.get(SOCKET_TICKET_PARAM);
  const claim =
    ticket === null ? null : await readSocketTicket(env.BETTER_AUTH_SECRET, ticket, now);
  if (
    claim === null ||
    !(await holderStands(createDb(env.DB), claim.accountId, claim.holder, now))
  ) {
    return plainText(401, "You're signed out. Sign in again.");
  }
  return await forwardToCell(request, ctx, claim.accountId, claim.holder);
};
