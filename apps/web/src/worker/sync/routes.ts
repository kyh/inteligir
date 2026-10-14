import {
  ackDispatchesRequestSchema,
  cancelDispatchRequestSchema,
  claimDispatchesRequestSchema,
  closeApprovalRequestSchema,
  createDispatchRequestSchema,
  DISPATCH_API_PATHS,
  dispatchStatusRequestSchema,
  openApprovalRequestSchema,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import {
  pullQuerySchema,
  pushRequestSchema,
  SYNC_API_PATHS,
} from "@repo/contract/cloud/sync/sync-schema";
import {
  SYNC_WS_PATH,
  SYNC_WS_PHONE_REQUESTS_PARAM,
  SYNC_WS_PLATFORM_PARAM,
} from "@repo/contract/cloud/sync/sync-ws";
import { refuse, refuseNoDeviceCredential, withBody } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import type { VerifiedDevice } from "../device/device-auth";
import { SOCKET_IDENTITY_HEADERS } from "./thread-sync-do";
import type { EventPage, SyncRefusal, SyncResult, ThreadSyncDO } from "./thread-sync-do";
import { threadSyncStub } from "./thread-sync-stub";

interface SyncCall {
  readonly device: VerifiedDevice;
  readonly request: Request;
  readonly stub: DurableObjectStub<ThreadSyncDO>;
  readonly url: URL;
}

const refusal = (refused: SyncRefusal): Response =>
  refuse(refused.code, refused.message, refused.deviceSeq);

const answer = <T>(result: SyncResult<T>): Response =>
  result.ok ? Response.json(result.value) : refusal(result);

// every stored body is the one text the push parse serialized, so a page splices each in verbatim:
// parsing it back only to serialize it again would spend the Worker's cpu on bytes it never reads
const pullBody = ({ hasMore, lastSeq, rows }: EventPage): string => {
  const events = rows.map(
    ({ event, ...envelope }) => `${JSON.stringify(envelope).slice(0, -1)},"event":${event}}`,
  );
  return `{"events":[${events.join(",")}],"hasMore":${hasMore},"lastSeq":${lastSeq}}`;
};

// the upgrade is forwarded whole for its handshake headers, with the identity stamped over any
// inbound copy and the bearer dropped
const openSocket = async ({ device, request, stub, url }: SyncCall): Promise<Response> => {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return refuse("bad-request", "This route only upgrades to a WebSocket.");
  }
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(SOCKET_IDENTITY_HEADERS.deviceId, device.deviceId);
  headers.set(
    SOCKET_IDENTITY_HEADERS.platform,
    url.searchParams.get(SYNC_WS_PLATFORM_PARAM) ?? "other",
  );
  const phoneRequests = url.searchParams.get(SYNC_WS_PHONE_REQUESTS_PARAM);
  if (phoneRequests === null) {
    headers.delete(SOCKET_IDENTITY_HEADERS.phoneRequests);
  } else {
    headers.set(SOCKET_IDENTITY_HEADERS.phoneRequests, phoneRequests);
  }
  return await stub.fetch(new Request("https://thread-sync/ws", { headers }));
};

const SYNC_ROUTES = new Map<string, (call: SyncCall) => Promise<Response>>([
  [
    `POST ${SYNC_API_PATHS.push}`,
    withBody(pushRequestSchema, "Malformed push batch.", async ({ device, stub }, body) =>
      answer(await stub.push(device.deviceId, body.events)),
    ),
  ],
  [
    `GET ${SYNC_API_PATHS.pull}`,
    async ({ stub, url }) => {
      const query = pullQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) {
        return refuse("bad-request", "Malformed pull cursor.");
      }
      const page = await stub.pull(query.data);
      return page.ok
        ? new Response(pullBody(page.value), { headers: { "content-type": "application/json" } })
        : refusal(page);
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.dispatch}`,
    withBody(
      createDispatchRequestSchema,
      'Send { kind: "turn", id, threadId, text }, { kind: "answer", id, approvalId, decision } or { kind: "capture", id, text }.',
      async ({ device, stub }, body) => answer(await stub.createDispatch(device.deviceId, body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.claim}`,
    withBody(
      claimDispatchesRequestSchema,
      "Send { kinds, limit? }.",
      async ({ device, stub }, body) => answer(await stub.claimDispatches(device.deviceId, body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.ack}`,
    withBody(ackDispatchesRequestSchema, "Send { claimToken, results }.", async ({ stub }, body) =>
      answer(await stub.ackDispatches(body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.status}`,
    withBody(dispatchStatusRequestSchema, "Send { ids }.", async ({ stub }, body) =>
      answer(await stub.dispatchStatus(body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.cancel}`,
    withBody(cancelDispatchRequestSchema, "Send { id }.", async ({ stub }, body) =>
      answer(await stub.cancelDispatch(body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.approval}`,
    withBody(
      openApprovalRequestSchema,
      "Send { id, threadId, turnId, payload }.",
      async ({ device, stub }, body) => answer(await stub.openApproval(device.deviceId, body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.approvalClose}`,
    withBody(closeApprovalRequestSchema, "Send { id }.", async ({ device, stub }, body) =>
      answer(await stub.closeApproval(device.deviceId, body)),
    ),
  ],
  [`GET ${DISPATCH_API_PATHS.approvals}`, async ({ stub }) => answer(await stub.listApprovals())],
  [`GET ${SYNC_WS_PATH}`, openSocket],
]);

export const handleSyncRoutes = async (request: Request, env: Env, url: URL): Promise<Response> => {
  const route = SYNC_ROUTES.get(`${request.method} ${url.pathname}`);
  if (route === undefined) {
    return refuse("not-found", "No such route.");
  }

  const device = await verifyDeviceCredential(
    createDb(env.DB),
    request.headers.get("authorization"),
  );
  if (device === null) {
    return refuseNoDeviceCredential();
  }

  return await route({ device, request, stub: threadSyncStub(env, device.userId), url });
};
