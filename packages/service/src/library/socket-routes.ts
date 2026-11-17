// The account's socket, `/v1/socket`, upgraded in the Worker and handed to the account's library
// cell, which keeps it. It opens with a ticket (`./socket-ticket`) on every client, since a
// browser's socket carries no header; the Worker names the cell from the account the ticket
// verified, and hands it a fresh upgrade naming only the session it verified, so nothing the
// client sent reaches the cell. The session's standing is checked at the upgrade alone, before the
// cell accepts and again after, so whatever ends it later closes its sockets here
// (`severSockets`).

import { SOCKET_TICKET_PARAM } from "@repo/contract/library/library-socket";
import { UnauthorizedError } from "@repo/contract/v1/errors";
import { and, eq, gt } from "drizzle-orm";

import { createDb } from "@repo/db/d1/client";
import type { Db } from "@repo/db/d1/client";
import { session } from "@repo/db/d1/schema";
import { plainText } from "../plain-http";
import { SOCKET_HOLDER_HEADER } from "./cell-sockets";
import { errorFields } from "../log";
import { libraryCell } from "./library-cell";
import { plainRefusal } from "../wire/rpc-refusal";
import { readSocketTicket } from "./socket-ticket";
import type { SocketClaim } from "./socket-ticket";

export const NOT_AN_UPGRADE = "This route only upgrades to a WebSocket.";

export const isUpgrade = (request: Request): boolean =>
  request.method === "GET" && request.headers.get("upgrade")?.toLowerCase() === "websocket";

const upgradeInCell = async (
  ctx: ExecutionContext,
  { accountId, sessionId }: SocketClaim,
): Promise<Response> =>
  await libraryCell(ctx.exports, accountId).fetch(
    new Request("https://library-cell/socket", {
      headers: { [SOCKET_HOLDER_HEADER]: sessionId, upgrade: "websocket" },
    }),
  );

// the ticket's session still stands: an end since it was minted shuts the socket out
const holderStands = async (
  db: Db,
  { accountId, sessionId }: SocketClaim,
  now: number,
): Promise<boolean> => {
  const row = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.userId, accountId),
        gt(session.expiresAt, new Date(now)),
      ),
    )
    .get();
  return row !== undefined;
};

// the sockets a session opened while it stood, closed once it no longer does: the session is
// already gone from D1, and no per-request check reaches a socket that has its upgrade. Best-effort:
// a failure costs a stale socket, never a live credential
export const severSockets = async (
  exports: Cloudflare.Exports,
  { accountId, sessionId }: SocketClaim,
): Promise<void> => {
  try {
    await libraryCell(exports, accountId).sever(sessionId);
  } catch (error) {
    console.warn({ event: "socket-sever-failed", ...errorFields(error) });
  }
};

// A socket `open` upgrades for the session its ticket names, while that session stands, for the
// account's door and each note's. The ticket rides the query string, which the logs
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
  if (claim === null || !(await holderStands(db, claim, now))) {
    return plainRefusal(new UnauthorizedError());
  }
  const opened = await open(claim);
  // a sever closes only the sockets already accepted, so an end that came between the check and the
  // accept closed nothing; read after the accept, that end is seen here or its sever sees the socket
  if (opened.status === 101 && !(await holderStands(db, claim, now))) {
    await severSockets(ctx.exports, claim);
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
    ? await openForHolder(env, ctx, url, async (claim) => await upgradeInCell(ctx, claim))
    : plainText(400, NOT_AN_UPGRADE);
