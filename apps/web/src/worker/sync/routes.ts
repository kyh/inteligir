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
import type {
  PullResponse,
  PushRequest,
  SyncEventRow,
} from "@repo/contract/cloud/sync/sync-schema";
import {
  SYNC_WS_PATH,
  SYNC_WS_PHONE_REQUESTS_PARAM,
  SYNC_WS_PLATFORM_PARAM,
} from "@repo/contract/cloud/sync/sync-ws";
import { z } from "zod";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import type { VerifiedDevice } from "../device/device-auth";
import { SOCKET_IDENTITY_HEADERS } from "./thread-sync-do";
import type {
  EventPage,
  StoredEvent,
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
const storedEvents = (request: PushRequest): StoredEvent[] =>
  request.events.map(({ createdAt, deviceSeq, event, threadId }) => ({
    createdAt,
    deviceSeq,
    event: JSON.stringify(event),
    threadId,
  }));

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

const withBody =
  <S extends z.ZodType>(
    schema: S,
    usage: string,
    run: (call: SyncCall, body: z.infer<S>) => Promise<Response>,
    // an empty body is a request at its defaults, so a claim may send nothing for its limit
    { emptyIsDefault = false } = {},
  ) =>
  async (call: SyncCall): Promise<Response> => {
    const body = schema.safeParse(
      await call.request.json().catch(() => (emptyIsDefault ? {} : null)),
    );
    return body.success ? await run(call, body.data) : refuse("bad-request", usage);
  };

const SYNC_ROUTES = new Map<string, (call: SyncCall) => Promise<Response>>([
  [
    `POST ${SYNC_API_PATHS.push}`,
    async ({ device, request, stub }) => {
      const body = pushRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? answer(await stub.push(device.deviceId, storedEvents(body.data)))
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
    `POST ${DISPATCH_API_PATHS.dispatch}`,
    withBody(
      createDispatchRequestSchema,
      'Send { kind: "turn", id, threadId, text } or { kind: "answer", id, approvalId, decision }.',
      async ({ device, stub }, body) => answer(await stub.createDispatch(device.deviceId, body)),
    ),
  ],
  [
    `POST ${DISPATCH_API_PATHS.claim}`,
    withBody(
      claimDispatchesRequestSchema,
      "Send { limit? }.",
      async ({ device, stub }, body) => answer(await stub.claimDispatches(device.deviceId, body)),
      { emptyIsDefault: true },
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
