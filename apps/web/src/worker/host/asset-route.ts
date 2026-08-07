// ---------------------------------------------------------------------------
// `POST /v1/host/assets` — attachment bytes, off the socket.
//
// Why a second transport for one capability: the Bridge carries attachments as
// base64 inside ONE WebSocket frame. A Durable Object caps a RECEIVED message
// at 32 MiB, base64 inflates by a third, and a multi-megabyte frame blocks
// every other message on the socket while it arrives — so the socket stops
// being a plausible way to move a file well before a user stops trying to paste
// one.
//
// This route is the same CAPABILITY as `writeVaultAsset`, over a transport that
// suits it: the body streams straight into R2 while a digest runs beside it, so
// nothing is ever buffered whole, and only the manifest row takes the vault's
// write lock. It is gated on that capability rather than on being an HTTP
// route, so a client class that may not write assets cannot reach them here
// either.
// ---------------------------------------------------------------------------

import { clientClassFor, mayInvoke } from "./client-class";
import { allowedOrigins } from "./origins";
import { readCredential, verifyHostSession } from "./session";
import type { UserVault } from "./vault/user-vault";

/**
 * Largest attachment this route accepts, in bytes (64 MiB). Enforced twice:
 * on `Content-Length` before a byte is streamed, and on the stored size after
 * (a chunked body declares no length).
 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * The object's half: verify the credential against this object's own name,
 * then stream the body into the vault.
 *
 * `dir` and `name` ride in the QUERY rather than in headers, and both are
 * sanitized inside the vault — the only place that decides where an asset may
 * land.
 */
export async function handleAssetUpload(
  request: Request,
  env: Env,
  vault: UserVault,
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
  if (clientClass === null || !mayInvoke(clientClass, "writeVaultAsset")) {
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
