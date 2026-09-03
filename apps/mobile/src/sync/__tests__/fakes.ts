import type {
  AckCapturesRequest,
  AckCapturesResponse,
  CaptureRequest,
  CaptureResponse,
  ClaimCapturesResponse,
} from "@repo/api/cloud/captures/captures-schema";
import type {
  PullQuery,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncEventRow,
} from "@repo/api/cloud/sync/sync-schema";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { VaultFileResponse } from "@repo/api/cloud/vault/vault-schema";
import type { CloudClient, CloudResult } from "@repo/api/cloud/client";

export function userRequest(threadId: string, text: string): ThreadEvent {
  return { type: "client/turn/requested", threadId, text, scope: threadScope() };
}

export function agentMessage(
  threadId: string,
  turnId: string,
  id: string,
  text: string,
): ThreadEvent {
  return {
    type: "item/completed",
    threadId,
    item: { type: "agentMessage", id, text },
    scope: turnScope(turnId),
  };
}

export function logRow(args: {
  seq: number;
  deviceId: string;
  deviceSeq: number;
  event: ThreadEvent;
}): SyncEventRow {
  // SAFETY: a ThreadEvent is valid JSON; planPage re-parses the opaque field at the boundary.
  const event = args.event as SyncEventRow["event"];
  return {
    seq: args.seq,
    threadId: args.event.threadId,
    deviceId: args.deviceId,
    deviceSeq: args.deviceSeq,
    event,
    createdAt: 0,
  };
}

export function ok<T>(value: T): CloudResult<T> {
  return { ok: true, value };
}

export interface FakeCloud {
  client: CloudClient;
  pushes: PushRequest[];
  claims: number;
  captures: CaptureRequest[];
  pullResults: CloudResult<PullResponse>[];
  captureResults: CloudResult<CaptureResponse>[];
}

export function createFakeCloud(): FakeCloud {
  const fake: FakeCloud = {
    pushes: [],
    claims: 0,
    captures: [],
    pullResults: [],
    captureResults: [],
    client: {
      push: (request) => {
        fake.pushes.push(request);
        return Promise.resolve<CloudResult<PushResponse>>(
          ok({ accepted: request.events.length, duplicates: 0, lastSeq: 0 }),
        );
      },
      pull: (query: PullQuery) =>
        Promise.resolve(
          fake.pullResults.shift() ?? ok({ events: [], lastSeq: query.afterSeq, hasMore: false }),
        ),
      createCapture: (request) => {
        fake.captures.push(request);
        return Promise.resolve(
          fake.captureResults.shift() ?? ok({ id: "cap_1", createdAt: 0, duplicate: false }),
        );
      },
      claimCaptures: () => {
        fake.claims += 1;
        return Promise.resolve<CloudResult<ClaimCapturesResponse>>(
          ok({ claimToken: "tok", captures: [], expiresAt: 1 }),
        );
      },
      ackCaptures: (request: AckCapturesRequest) =>
        Promise.resolve<CloudResult<AckCapturesResponse>>(
          ok({ results: request.ids.map((id) => ({ id, outcome: "deleted" as const })) }),
        ),
      account: () => Promise.resolve(ok({ id: "user_fake", email: "signed-in@example.test" })),
      vaultTree: () => Promise.resolve(ok({ commit: "0".repeat(40), entries: [], next: null })),
      vaultAssetSource: (query) => ({
        uri: `https://cloud.test/v1/vault/asset?path=${query.path}&ref=${query.ref}`,
        headers: { authorization: "Bearer igd_fake" },
      }),
      vaultFile: () =>
        Promise.resolve<CloudResult<VaultFileResponse>>({
          ok: false,
          failure: { kind: "refused", code: "not-found", message: "empty fake", deviceSeq: null },
        }),
    },
  };
  return fake;
}
