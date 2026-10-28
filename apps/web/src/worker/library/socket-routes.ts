// The account's socket, upgraded in the Worker and handed to the account's library cell, which
// keeps it. Two doors: `/v1/socket` opens with a ticket (`./socket-ticket`), as every client will,
// since a browser's socket carries no header; `/v1/sync/ws` opens with the device's bearer, as
// today's apps do, until their last build moves (behind the client build floor). Either names the
// cell from the account the credential verified, and stamps the holder over any copy the request
// carried; the bearer and the ticket go no further.

import { SOCKET_TICKET_PARAM } from "@repo/contract/cloud/library/library-socket";
import { and, eq, gt, isNull } from "drizzle-orm";

import { refuse, refuseNoDeviceCredential } from "../cloud-http";
import { createDb } from "../db/client";
import type { Db } from "../db/client";
import { device, session } from "../db/schema";
import { verifyDeviceCredential } from "../device/device-auth";
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

// today's apps: the device's bearer on the upgrade
export const handleSyncSocket = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  if (request.method !== "GET") {
    return refuse("not-found", "No such route.");
  }
  const verified = await verifyDeviceCredential(
    createDb(env.DB),
    request.headers.get("authorization"),
  );
  if (verified === null) {
    return refuseNoDeviceCredential();
  }
  if (!isUpgrade(request)) {
    return refuse("bad-request", NOT_AN_UPGRADE);
  }
  return await forwardToCell(request, ctx, verified.userId, {
    id: verified.deviceId,
    kind: "device",
  });
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

// every client: the ticket in the query string, which the logs redact; the build floor does not
// apply, since a browser's socket cannot name its build and the ticket came from a call that met it
export const handleLibrarySocket = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (!isUpgrade(request)) {
    return refuse("bad-request", NOT_AN_UPGRADE);
  }
  const now = Date.now();
  const ticket = url.searchParams.get(SOCKET_TICKET_PARAM);
  const claim =
    ticket === null ? null : await readSocketTicket(env.BETTER_AUTH_SECRET, ticket, now);
  if (
    claim === null ||
    !(await holderStands(createDb(env.DB), claim.accountId, claim.holder, now))
  ) {
    return refuse("unauthorized", "No valid socket ticket.");
  }
  return await forwardToCell(request, ctx, claim.accountId, claim.holder);
};
