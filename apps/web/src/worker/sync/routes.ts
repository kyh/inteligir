import {
  ackCapturesRequestSchema,
  CAPTURE_API_PATHS,
  captureRequestSchema,
  claimCapturesRequestSchema,
} from "@repo/api/cloud/captures/captures-schema";
import {
  ackDispatchesRequestSchema,
  cancelDispatchRequestSchema,
  claimDispatchesRequestSchema,
  closeApprovalRequestSchema,
  createDispatchRequestSchema,
  DISPATCH_API_PATHS,
  dispatchStatusRequestSchema,
  openApprovalRequestSchema,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import {
  pullQuerySchema,
  pushRequestSchema,
  SYNC_API_PATHS,
} from "@repo/api/cloud/sync/sync-schema";
import type { PullResponse, PushRequest, SyncEventRow } from "@repo/api/cloud/sync/sync-schema";
import {
  SYNC_WS_PATH,
  SYNC_WS_PHONE_REQUESTS_PARAM,
  SYNC_WS_PLATFORM_PARAM,
} from "@repo/api/cloud/sync/sync-ws";
import { z } from "zod";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import type { VerifiedDevice } from "../device/device-auth";
import { SOCKET_IDENTITY_HEADERS } from "./thread-sync-do";
import type {
  EventBatch,
  EventPage,
  SyncRefusal,
  SyncResult,
  ThreadSyncDO,
} from "./thread-sync-do";

// The object is named from the verified userId, never from a path or body, and every body is
// parsed here, so the object is handed typed values and the verified deviceId as an argument.

export const threadSyncStub = (env: Env, userId: string): DurableObjectStub<ThreadSyncDO> =>
  env.THREAD_SYNC.getByName(`user:${userId}`);

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

// the log compares a replayed body byte for byte, so each is serialized once, here, and the
// object stores and compares that text. a stale install's `threads` goes no further than the parse.
const storedBatch = (request: PushRequest): EventBatch => ({
  events: request.events.map(({ createdAt, deviceSeq, event, threadId }) => ({
    createdAt,
    deviceSeq,
    event: JSON.stringify(event),
    threadId,
  })),
});

// a parse failure is storage corruption; surface the raw string rather than 500 every pull forever
const storedEventSchema = z.json();

const parseStoredEvent = (stored: string): SyncEventRow["event"] => {
  let source: unknown;
  try {
    source = JSON.parse(stored);
  } catch {
    return stored;
  }
  const event = storedEventSchema.safeParse(source);
  return event.success ? event.data : stored;
};

const pullResponse = (page: EventPage): PullResponse => ({
  events: page.rows.map((row) => ({ ...row, event: parseStoredEvent(row.event) })),
  hasMore: page.hasMore,
  lastSeq: page.lastSeq,
});

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
    async ({ device, request, stub }) => {
      const body = pushRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.push(device.deviceId, storedBatch(body.data)))
        : refuse("bad-request", "Malformed push batch.");
    },
  ],
  [
    `GET ${SYNC_API_PATHS.pull}`,
    async ({ stub, url }) => {
      const query = pullQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) {
        return refuse("bad-request", "Malformed pull cursor.");
      }
      const page = await stub.pull(query.data);
      return page.ok ? Response.json(pullResponse(page.value)) : refusal(page);
    },
  ],
  [
    `POST ${CAPTURE_API_PATHS.capture}`,
    async ({ request, stub }) => {
      const body = captureRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.capture(body.data))
        : refuse("bad-request", "Send { text, idempotencyKey }.");
    },
  ],
  [
    `POST ${CAPTURE_API_PATHS.claim}`,
    async ({ request, stub }) => {
      // an empty body is a claim at the default limit
      const body = claimCapturesRequestSchema.safeParse(await request.json().catch(() => ({})));
      return body.success
        ? answer(await stub.claimCaptures(body.data))
        : refuse("bad-request", "Send { limit? }.");
    },
  ],
  [
    `POST ${CAPTURE_API_PATHS.ack}`,
    async ({ request, stub }) => {
      const body = ackCapturesRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.ackCaptures(body.data))
        : refuse("bad-request", "Send { claimToken, ids }.");
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.dispatch}`,
    async ({ device, request, stub }) => {
      const body = createDispatchRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.createDispatch(device.deviceId, body.data))
        : refuse(
            "bad-request",
            'Send { kind: "turn", id, threadId, text } or { kind: "answer", id, approvalId, decision }.',
          );
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.claim}`,
    async ({ device, request, stub }) => {
      // an empty body is a claim at the default limit
      const body = claimDispatchesRequestSchema.safeParse(await request.json().catch(() => ({})));
      return body.success
        ? answer(await stub.claimDispatches(device.deviceId, body.data))
        : refuse("bad-request", "Send { limit? }.");
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.ack}`,
    async ({ request, stub }) => {
      const body = ackDispatchesRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.ackDispatches(body.data))
        : refuse("bad-request", "Send { claimToken, results }.");
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.status}`,
    async ({ request, stub }) => {
      const body = dispatchStatusRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.dispatchStatus(body.data))
        : refuse("bad-request", "Send { ids }.");
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.cancel}`,
    async ({ request, stub }) => {
      const body = cancelDispatchRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.cancelDispatch(body.data))
        : refuse("bad-request", "Send { id }.");
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.approval}`,
    async ({ device, request, stub }) => {
      const body = openApprovalRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.openApproval(device.deviceId, body.data))
        : refuse("bad-request", "Send { id, threadId, turnId, payload }.");
    },
  ],
  [
    `POST ${DISPATCH_API_PATHS.approvalClose}`,
    async ({ device, request, stub }) => {
      const body = closeApprovalRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.closeApproval(device.deviceId, body.data))
        : refuse("bad-request", "Send { id }.");
    },
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
    return refuse("unauthorized", "No valid device credential.");
  }

  return await route({ device, request, stub: threadSyncStub(env, device.userId), url });
};

// a failure propagates so beforeDelete aborts and the account survives to retry
export const purgeThreadSync = async (env: Env, userId: string): Promise<void> => {
  await threadSyncStub(env, userId).purge();
};

// best-effort: the revoke is already committed in D1, so a failure costs a stale socket, never a working credential
export const severDeviceSockets = async (
  env: Env,
  userId: string,
  deviceId: string,
): Promise<void> => {
  try {
    await threadSyncStub(env, userId).severDevice(deviceId);
  } catch {
    // the revoke already stands
  }
};

// best-effort like the sever: a lost ping costs staleness until the next poll
export const pingVaultAdvanced = async (
  env: Env,
  userId: string,
  pushingDeviceId: string,
): Promise<void> => {
  try {
    await threadSyncStub(env, userId).vaultPing(pushingDeviceId);
  } catch {
    // the push already stands
  }
};
