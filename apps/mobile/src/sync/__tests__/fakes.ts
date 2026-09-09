// oxlint-disable eslint/require-await -- every method here is a synchronous stand-in for an async
// CloudClient method; `async` is the contract, and dropping it trips promise-function-async
import type {
  AckCapturesRequest,
  CaptureRequest,
  CaptureResponse,
} from "@repo/api/cloud/captures/captures-schema";
import type {
  PullQuery,
  PullResponse,
  PushRequest,
  SyncEventRow,
} from "@repo/api/cloud/sync/sync-schema";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { CloudClient, CloudResult } from "@repo/api/cloud/client";

export const userRequest = (threadId: string, text: string): ThreadEvent => ({
  scope: threadScope(),
  text,
  threadId,
  type: "client/turn/requested",
});

export const agentMessage = (
  threadId: string,
  turnId: string,
  id: string,
  text: string,
): ThreadEvent => ({
  item: { id, text, type: "agentMessage" },
  scope: turnScope(turnId),
  threadId,
  type: "item/completed",
});

export const logRow = (args: {
  seq: number;
  deviceId: string;
  deviceSeq: number;
  event: ThreadEvent;
}): SyncEventRow => {
  // SAFETY: a ThreadEvent is valid JSON; planPage re-parses the opaque field at the boundary.
  const event = args.event as SyncEventRow["event"];
  return {
    createdAt: 0,
    deviceId: args.deviceId,
    deviceSeq: args.deviceSeq,
    event,
    seq: args.seq,
    threadId: args.event.threadId,
  };
};

export const ok = <T>(value: T): CloudResult<T> => ({ ok: true, value });

export interface FakeCloud {
  client: CloudClient;
  pushes: PushRequest[];
  claims: number;
  captures: CaptureRequest[];
  pullResults: CloudResult<PullResponse>[];
  captureResults: CloudResult<CaptureResponse>[];
}

export const createFakeCloud = (): FakeCloud => {
  const fake: FakeCloud = {
    captureResults: [],
    captures: [],
    claims: 0,
    client: {
      account: async () => ok({ email: "signed-in@example.test", id: "user_fake" }),
      ackCaptures: async (request: AckCapturesRequest) =>
        ok({ results: request.ids.map((id) => ({ id, outcome: "deleted" as const })) }),
      claimCaptures: async () => {
        fake.claims += 1;
        return ok({ captures: [], claimToken: "tok", expiresAt: 1 });
      },
      createCapture: async (request) => {
        fake.captures.push(request);
        return fake.captureResults.shift() ?? ok({ createdAt: 0, duplicate: false, id: "cap_1" });
      },
      pull: async (query: PullQuery) =>
        fake.pullResults.shift() ?? ok({ events: [], hasMore: false, lastSeq: query.afterSeq }),
      push: async (request) => {
        fake.pushes.push(request);
        return ok({ accepted: request.events.length, duplicates: 0, lastSeq: 0 });
      },
      vaultAssetSource: (query) => ({
        headers: { authorization: "Bearer igd_fake" },
        uri: `https://cloud.test/v1/vault/asset?path=${query.path}&ref=${query.ref}`,
      }),
      vaultFile: async () => ({
        failure: { code: "not-found", deviceSeq: null, kind: "refused", message: "empty fake" },
        ok: false,
      }),
      vaultTree: async () => ok({ commit: "0".repeat(40), entries: [], next: null }),
    },
    pullResults: [],
    pushes: [],
  };
  return fake;
};
