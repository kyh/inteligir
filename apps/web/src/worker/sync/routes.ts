import { SYNC_WS_PLATFORM_PARAM } from "@repo/cloud-contract/ws";
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
//   POST /v1/capture           → /capture         quick capture in
//   POST /v1/sync/push         → /push            outbox batch (idempotent)
//   GET  /v1/sync/pull         → /pull            merged log, paged by seq
//   GET  /v1/sync/captures     → /captures        the inbox
//   POST /v1/sync/captures/ack → /captures/ack    exactly-once handoff
//   GET  /v1/sync/ws           → /ws              invalidation socket
//
// The ws upgrade is Bearer-authed like everything else — ticket-free on
// purpose: native callers set headers on the dial, and there is no browser
// cookie path to protect (the contract's ws module states this).
// ---------------------------------------------------------------------------

const DO_PATH_BY_ROUTE: Record<string, string> = {
  "POST /v1/capture": "/capture",
  "POST /v1/sync/push": "/push",
  "GET /v1/sync/pull": "/pull",
  "GET /v1/sync/captures": "/captures",
  "POST /v1/sync/captures/ack": "/captures/ack",
  "GET /v1/sync/ws": "/ws",
};

export async function handleSyncRoutes(request: Request, env: Env, url: URL): Promise<Response> {
  const doPath = DO_PATH_BY_ROUTE[`${request.method} ${url.pathname}`];
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
 * holds. A non-OK answer throws so the surrounding `beforeDelete` aborts and
 * the account survives to ask again — the step is idempotent.
 */
export async function purgeThreadSync(env: Env, userId: string): Promise<void> {
  const stub = env.THREAD_SYNC.getByName(`user:${userId}`);
  const response = await stub.fetch("https://thread-sync/purge", { method: "POST" });
  if (!response.ok) {
    throw new Error(`thread-sync purge failed: ${response.status}`);
  }
}
