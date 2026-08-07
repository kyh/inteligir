// ---------------------------------------------------------------------------
// `POST /v1/host/ticket` — the object's half of the mint.
//
// This is where a session becomes a socket ticket, and it is the ONLY place a
// capability class is decided (./client-class). Both decisions are made from
// the same credential in the same breath: who this is, and which of the two
// classes the way they proved it admits to. A client says nothing about either
// and has no field on the wire that could.
//
// The Origin allowlist applies HERE and only here (./origins) — a cookie is the
// one credential a cross-site page can make a browser send, so the mint is the
// one request that needs corroborating.
// ---------------------------------------------------------------------------

import { clientClassFor } from "./client-class";
import { allowedOrigins } from "./origins";
import { readCredential, verifyHostSession } from "./session";
import type { SocketTickets } from "./socket-ticket";

export async function handleTicketMint(
  request: Request,
  env: Env,
  tickets: SocketTickets,
  hostName: string | undefined,
): Promise<Response> {
  const credential = readCredential(request.headers);
  if (credential === null) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const session = await verifyHostSession(env, url.origin, credential, hostName);
  if (session === null) return new Response("unauthorized", { status: 401 });

  const clientClass = clientClassFor(
    credential,
    request.headers.get("origin"),
    allowedOrigins(env),
  );
  if (clientClass === null) return new Response("forbidden", { status: 403 });

  const minted = tickets.mint(clientClass, Date.now());
  // Never cached, never revalidated: a ticket is spent by the first socket that
  // presents it, so a second reader of this response holds nothing.
  return Response.json(minted, { headers: { "cache-control": "no-store" } });
}
