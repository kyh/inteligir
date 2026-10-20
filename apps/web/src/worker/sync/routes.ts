import { SYNC_WS_PATH } from "@repo/contract/cloud/sync/sync-ws";
import { refuse, refuseNoDeviceCredential } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import { SOCKET_IDENTITY_HEADERS } from "./account-socket-do";
import { accountSocketStub } from "./account-socket-stub";

// the account socket is the one route under /v1/sync/. the upgrade is forwarded whole for its
// handshake headers, with the identity stamped over any inbound copy and the bearer dropped
export const handleSyncRoutes = async (request: Request, env: Env, url: URL): Promise<Response> => {
  if (request.method !== "GET" || url.pathname !== SYNC_WS_PATH) {
    return refuse("not-found", "No such route.");
  }

  const device = await verifyDeviceCredential(
    createDb(env.DB),
    request.headers.get("authorization"),
  );
  if (device === null) {
    return refuseNoDeviceCredential();
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return refuse("bad-request", "This route only upgrades to a WebSocket.");
  }
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(SOCKET_IDENTITY_HEADERS.deviceId, device.deviceId);
  return await accountSocketStub(env, device.userId).fetch(
    new Request("https://account-socket/ws", { headers }),
  );
};
