// ---------------------------------------------------------------------------
// `POST /v1/host/:userId/assets` — attachment bytes, off the socket.
//
// Why a second transport for one capability: the Bridge carries attachments as
// base64 inside ONE WebSocket frame. On the desktop that was fine (the local
// transport sized its frame ceiling at 64 MiB for exactly this). A Durable
// Object caps a RECEIVED message at 32 MiB, base64 inflates by a third, and a
// multi-megabyte frame blocks every other message on the socket while it
// arrives — so the socket stops being a plausible way to move a file well
// before a user stops trying to paste one.
//
// This route is the same CAPABILITY as `writeVaultAsset`, over a transport that
// suits it: the body streams straight into R2 while a digest runs beside it, so
// nothing is ever buffered whole, and only the manifest row takes the vault's
// write lock. It is gated on that capability rather than on being an HTTP
// route, so a client class that may not write assets cannot reach them here
// either.
//
// The Worker half ADDRESSES; the object VERIFIES — the same split as the
// socket, and the reason there is no forwarded verdict to forge.
// ---------------------------------------------------------------------------

import { mayInvoke, SESSION_CLIENT_CLASS } from "./client-class";
import { matchHostPath, userHostName } from "./host-address";
import { allowedOrigins, originAllowed } from "./origins";
import { readBearer, verifyHostSession } from "./session";
import type { UserVault } from "./vault/user-vault";

/**
 * Largest attachment this route accepts, in bytes (64 MiB). Enforced twice:
 * on `Content-Length` before a byte is streamed, and on the stored size after
 * (a chunked body declares no length).
 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** The userId a `POST /v1/host/:userId/assets` addresses, or `null`. */
export function matchHostAssetPath(method: string, pathname: string): string | null {
  return method === "POST" ? matchHostPath(pathname, "assets") : null;
}

/** Answer the asset upload, or `null` when this request is not one. */
export async function routeHostAsset(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const userId = matchHostAssetPath(request.method, pathname);
  if (userId === null) return null;
  // The same allowlist the socket is held to, for the same reason: the only
  // client is the workspace served from a known origin, and admitting an
  // unknown one costs more than it buys.
  if (!originAllowed(request.headers.get("origin"), allowedOrigins(env))) {
    return new Response("origin not allowed", { status: 403 });
  }
  return env.UserHost.getByName(userHostName(userId)).fetch(request);
}

/**
 * The object's half: verify the bearer against this object's own name, then
 * stream the body into the vault.
 *
 * `dir` and `name` ride in the QUERY rather than in headers so the preflight
 * stays the one the auth surface already allows; both are sanitized inside the
 * vault, which is the only place that decides where an asset may land.
 */
export async function handleAssetUpload(
  request: Request,
  env: Env,
  vault: UserVault,
  hostName: string | undefined,
): Promise<Response> {
  const token = readBearer(request.headers);
  if (token === null) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const session = await verifyHostSession(env, url.origin, token, hostName);
  if (session === null) return new Response("unauthorized", { status: 401 });
  if (!mayInvoke(SESSION_CLIENT_CLASS, "writeVaultAsset")) {
    return new Response("forbidden", { status: 403 });
  }

  const declared = parseContentLength(request.headers.get("content-length"));
  if (declared !== null && declared > MAX_UPLOAD_BYTES) {
    return new Response("attachment too large", { status: 413 });
  }
  const body = request.body;
  if (body === null) return new Response("missing body", { status: 400 });

  const result = await vault.uploadAsset(
    url.searchParams.get("dir") ?? "assets",
    url.searchParams.get("name") ?? "attachment",
    body,
    MAX_UPLOAD_BYTES,
  );
  if (!result.ok) return new Response("attachment too large", { status: 413 });
  // The same shape `writeVaultAsset` answers with, so the two transports are
  // interchangeable to a caller that just wants the path it landed at.
  return Response.json({ path: result.path });
}

/** A non-negative integer `Content-Length`, or `null` when absent/malformed —
 * a missing header just skips the pre-stream check. */
function parseContentLength(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
