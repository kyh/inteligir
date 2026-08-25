import { CAPTURE_API_PATHS } from "@repo/api/cloud/captures/captures-schema";
import { SYNC_API_PATHS } from "@repo/api/cloud/sync/sync-schema";
import { SYNC_WS_PATH, SYNC_WS_PLATFORM_PARAM } from "@repo/api/cloud/sync/sync-ws";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";

// ---------------------------------------------------------------------------
// `/v1/sync/*` + `/v1/capture` — the device-authed surface, all of it served
// by the caller's own ThreadSyncDO. This module is the chokepoint where the
// two security facts hold:
//
//   1. The credential is verified FIRST (hash compare in D1, never cached),
//      and the object is named from the VERIFIED userId — no path or body
//      carries one, so a caller holding no credential cannot bring an object
//      into existence by naming it.
//   2. The DO trusts `x-device-id` / `x-device-platform` because this Worker
//      is its only caller — so those headers are stripped-and-stamped here,
//      never forwarded from the wire.
//
// The public paths map 1:1 onto the object's internal ones:
//
//   POST /v1/capture             → /capture        quick capture in
//   POST /v1/sync/push           → /push           outbox batch (idempotent)
//   GET  /v1/sync/pull           → /pull           merged log, paged by seq
//   POST /v1/sync/captures/claim → /captures/claim take the inbox for a window
//   POST /v1/sync/captures/ack   → /captures/ack   delete what the claim owns
//   GET  /v1/sync/ws             → /ws             invalidation socket
//
// The ws upgrade is Bearer-authed like everything else — ticket-free on
// purpose: native callers set headers on the dial, and there is no browser
// cookie path to protect (the contract's ws module states this).
// ---------------------------------------------------------------------------

const DO_PATH_BY_ROUTE = new Map<string, string>([
  [`POST ${CAPTURE_API_PATHS.capture}`, "/capture"],
  [`POST ${SYNC_API_PATHS.push}`, "/push"],
  [`GET ${SYNC_API_PATHS.pull}`, "/pull"],
  [`POST ${CAPTURE_API_PATHS.claim}`, "/captures/claim"],
  [`POST ${CAPTURE_API_PATHS.ack}`, "/captures/ack"],
  [`GET ${SYNC_WS_PATH}`, "/ws"],
]);

export async function handleSyncRoutes(request: Request, env: Env, url: URL): Promise<Response> {
  const doPath = DO_PATH_BY_ROUTE.get(`${request.method} ${url.pathname}`);
  if (doPath === undefined) return refuse("not-found", "No such route.");

  const verified = await verifyDeviceCredential(
    createDb(env.DB),
    request.headers.get("authorization"),
  );
  if (verified === null) return refuse("unauthorized", "No valid device credential.");

  if (doPath === "/ws" && request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return refuse("bad-request", "This route only upgrades to a WebSocket.");
  }

  const target = new URL(`https://thread-sync${doPath}`);
  if (doPath === "/pull") target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-device-id", verified.deviceId);
  headers.set("x-device-platform", url.searchParams.get(SYNC_WS_PLATFORM_PARAM) ?? "other");

  const stub = env.THREAD_SYNC.getByName(`user:${verified.userId}`);
  return await stub.fetch(
    new Request(target, { method: request.method, headers, body: request.body }),
  );
}

/**
 * The account-deletion hook's DO half: drop everything the user's ThreadSyncDO
 * holds and tombstone it. A non-OK answer throws so the surrounding
 * `beforeDelete` aborts and the account survives to ask again — the step is
 * idempotent.
 */
export async function purgeThreadSync(env: Env, userId: string): Promise<void> {
  const stub = env.THREAD_SYNC.getByName(`user:${userId}`);
  const response = await stub.fetch("https://thread-sync/purge", { method: "POST" });
  if (!response.ok) {
    throw new Error(`thread-sync purge failed: ${response.status}`);
  }
}

/**
 * Close the live sockets a just-revoked device holds. Best-effort by design:
 * revocation's guarantee is that the next REQUEST fails, and it is already
 * committed in D1 before this runs — so a failure here costs a stale socket
 * until it disconnects, never a credential that keeps working.
 */
export async function severDeviceSockets(
  env: Env,
  userId: string,
  deviceId: string,
): Promise<void> {
  const stub = env.THREAD_SYNC.getByName(`user:${userId}`);
  try {
    await stub.fetch("https://thread-sync/sever-device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
  } catch {
    // See above: the revoke already stands.
  }
}
