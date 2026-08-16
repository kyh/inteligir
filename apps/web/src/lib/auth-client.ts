import { createAuthClient } from "better-auth/client";

import { isRecord } from "@repo/bridge/wire-helpers";
import type { MintedTicket } from "@repo/bridge/ws-bridge";

// ---------------------------------------------------------------------------
// The browser's Better Auth client. No `baseURL`: the app is served by the same
// Worker that answers `/api/auth/*`, so the default relative base is correct on
// localhost, on a preview, and in production alike — the same reason the server
// derives its baseURL from the request origin.
//
// The ONLY credential this page holds is the session cookie, and it never reads
// it: `httpOnly` keeps it out of JavaScript, and the socket authenticates with
// a ticket minted over it (`mintSocketTicket` below). Nothing here asks Better
// Auth for `session.token`, because handing the raw session token to page
// JavaScript makes every XSS a permanent account takeover rather than a
// one-socket one.
// ---------------------------------------------------------------------------

export const authClient = createAuthClient();

/** The signed-in user, as the app routes guard on them. */
export type ActiveSession = {
  readonly userId: string;
  readonly email: string;
};

export async function activeSession(): Promise<ActiveSession | null> {
  const { data } = await authClient.getSession();
  if (data === null) return null;
  return { userId: data.user.id, email: data.user.email };
}

/**
 * Mint the single-use ticket the next Bridge socket authenticates with.
 *
 * Same-origin POST, so the browser attaches the session cookie and an `Origin`
 * the host recognizes — which is exactly the pair that makes this the `web`
 * class server-side. A 401 is the session being gone, and it is terminal; every
 * other failure is the network and the bridge backs off.
 */
export async function mintSocketTicket(): Promise<MintedTicket> {
  const response = await fetch("/v1/host/ticket", { method: "POST" }).catch(() => null);
  if (response === null) return { ok: false, reason: "unavailable" };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };
  const body: unknown = await response.json().catch(() => null);
  const ticket = isRecord(body) ? body.ticket : undefined;
  return typeof ticket === "string" && ticket !== ""
    ? { ok: true, ticket }
    : { ok: false, reason: "unavailable" };
}

/** The message an auth failure should show. Better Auth answers a rejected
 * credential with a `message`; a transport failure has none, so it gets one. */
export function authErrorMessage(error: { message?: string | undefined } | null): string {
  return error?.message ?? "Something went wrong — try again.";
}
