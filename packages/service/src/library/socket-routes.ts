// The account's socket, `/v1/socket`, upgraded in the Worker and handed to the account's library
// cell, which keeps it. It opens with a ticket (`./socket-ticket`) on every client, since a
// browser's socket carries no header; the Worker names the cell from the account the ticket
// verified, and stamps its holder over any copy the request carried. The ticket goes no further.
// The holder's standing is checked at the upgrade alone, before the cell accepts and again after,
// so whatever ends its session later closes its sockets here (`severSockets`).

import { SOCKET_TICKET_PARAM } from "@repo/contract/library/library-socket";
import { and, eq, gt } from "drizzle-orm";

import { createDb } from "@repo/db/d1/client";
import type { Db } from "@repo/db/d1/client";
import { session } from "@repo/db/d1/schema";
import { plainText } from "../plain-http";
import { CELL_SOCKET_PATH, holderHeaderValue } from "./cell-sockets";
import type { SocketHolder } from "./cell-sockets";
import { errorFields } from "../log";
import { libraryCell } from "./library-cell";
import { headersForCell, SOCKET_HOLDER_HEADER } from "./library-principal";
import { readSocketTicket } from "./socket-ticket";
import type { SocketClaim } from "./socket-ticket";

export const NOT_AN_UPGRADE = "This route only upgrades to a WebSocket.";

export const isUpgrade = (request: Request): boolean =>
  request.method === "GET" && request.headers.get("upgrade")?.toLowerCase() === "websocket";

// the upgrade forwarded whole for its handshake headers, with the verified holder stamped
const forwardToCell = async (
  request: Request,
  ctx: ExecutionContext,
  accountId: string,
  holder: SocketHolder,
): Promise<Response> => {
  const headers = headersForCell(request);
  headers.set(SOCKET_HOLDER_HEADER, holderHeaderValue(holder));
  return await libraryCell(ctx.exports, accountId).fetch(
    new Request(`https://library-cell${CELL_SOCKET_PATH}`, { headers }),
  );
};

// the ticket's session still stands: an end since it was minted shuts the socket out
const holderStands = async (
  db: Db,
  accountId: string,
  holder: SocketHolder,
  now: number,
): Promise<boolean> => {
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

// the sockets a holder opened while it stood, closed once it no longer does: the session is
// already gone from D1, and no per-request check reaches a socket that has its upgrade. Best-effort:
// a failure costs a stale socket, never a live credential
export const severSockets = async (
  exports: Cloudflare.Exports,
  accountId: string,
  holder: SocketHolder,
): Promise<void> => {
  try {
    await libraryCell(exports, accountId).sever(holder);
  } catch (error) {
    console.warn({ event: "socket-sever-failed", holder: holder.kind, ...errorFields(error) });
  }
};

// A socket `open` upgrades for the holder its ticket names, while that holder's session stands,
// for the account's door and each note's. The ticket rides the query string, which the logs
// redact; the build floor does not apply, since a browser's socket cannot name its build and the
// ticket came from a call that met it.
export const openForHolder = async (
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  open: (claim: SocketClaim) => Promise<Response>,
): Promise<Response> => {
  const now = Date.now();
  const ticket = url.searchParams.get(SOCKET_TICKET_PARAM);
  const claim =
    ticket === null ? null : await readSocketTicket(env.BETTER_AUTH_SECRET, ticket, now);
  const db = createDb(env.DB);
  if (claim === null || !(await holderStands(db, claim.accountId, claim.holder, now))) {
    return plainText(401, "You're signed out. Sign in again.");
  }
  const opened = await open(claim);
  // a sever closes only the sockets already accepted, so an end that came between the check and the
  // accept closed nothing; read after the accept, that end is seen here or its sever sees the socket
  if (opened.status === 101 && !(await holderStands(db, claim.accountId, claim.holder, now))) {
    await severSockets(ctx.exports, claim.accountId, claim.holder);
  }
  return opened;
};

export const handleLibrarySocket = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> =>
  isUpgrade(request)
    ? await openForHolder(
        env,
        ctx,
        url,
        async ({ accountId, holder }) => await forwardToCell(request, ctx, accountId, holder),
      )
    : plainText(400, NOT_AN_UPGRADE);
