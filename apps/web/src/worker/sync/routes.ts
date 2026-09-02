import { CAPTURE_API_PATHS } from "@repo/api/cloud/captures/captures-schema";
import { SYNC_API_PATHS } from "@repo/api/cloud/sync/sync-schema";
import { SYNC_WS_PATH, SYNC_WS_PLATFORM_PARAM } from "@repo/api/cloud/sync/sync-ws";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";

// The object is named from the verified userId, never from a path or body. The DO trusts
// x-device-id / x-device-platform because this Worker is its only caller, so they are stripped
// and stamped here, never forwarded from the wire.

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

// a failure propagates so beforeDelete aborts and the account survives to retry
export async function purgeThreadSync(env: Env, userId: string): Promise<void> {
  await env.THREAD_SYNC.getByName(`user:${userId}`).purge();
}

// best-effort: the revoke is already committed in D1, so a failure costs a stale socket, never a working credential
export async function severDeviceSockets(
  env: Env,
  userId: string,
  deviceId: string,
): Promise<void> {
  try {
    await env.THREAD_SYNC.getByName(`user:${userId}`).severDevice(deviceId);
  } catch {
    // the revoke already stands
  }
}

// best-effort like the sever: a lost ping costs staleness until the next poll
export async function pingVaultAdvanced(
  env: Env,
  userId: string,
  pushingDeviceId: string,
): Promise<void> {
  try {
    await env.THREAD_SYNC.getByName(`user:${userId}`).vaultPing(pushingDeviceId);
  } catch {
    // the push already stands
  }
}
