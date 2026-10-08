import { syncEventRowSchema } from "@repo/contract/cloud/sync/sync-schema";
import type {
  PullQuery,
  PullResponse,
  PushRequest,
  SyncEventRow,
} from "@repo/contract/cloud/sync/sync-schema";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { CloudClient, CloudResult } from "@repo/contract/cloud/client";
import { fakeCloudClient, ok } from "@repo/contract/cloud/test-support/fake-cloud-client";

export { ok } from "@repo/contract/cloud/test-support/fake-cloud-client";

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

export const agentDelta = (
  threadId: string,
  turnId: string,
  itemId: string,
  delta: string,
): ThreadEvent => ({
  delta,
  itemId,
  scope: turnScope(turnId),
  threadId,
  type: "item/agentMessage/delta",
});

export const logRow = (args: {
  seq: number;
  deviceId: string;
  deviceSeq: number;
  event: ThreadEvent;
}): SyncEventRow =>
  syncEventRowSchema.parse({
    createdAt: 0,
    deviceId: args.deviceId,
    deviceSeq: args.deviceSeq,
    event: args.event,
    seq: args.seq,
    threadId: args.event.threadId,
  });

export interface FakeCloud {
  client: CloudClient;
  pushes: PushRequest[];
  pullResults: CloudResult<PullResponse>[];
}

// `overrides` answers in place of the defaults below, the dispatch inbox's routes among them
export const createFakeCloud = (overrides: Partial<CloudClient> = {}): FakeCloud => {
  const fake: FakeCloud = {
    client: fakeCloudClient({
      account: async () => ok({ email: "signed-in@example.test", id: "user_fake" }),
      pull: async (query: PullQuery) =>
        fake.pullResults.shift() ?? ok({ events: [], hasMore: false, lastSeq: query.afterSeq }),
      push: async (request) => {
        fake.pushes.push(request);
        return ok({ accepted: request.events.length, duplicates: 0, lastSeq: 0 });
      },
      signOut: async () => ok({ revoked: true }),
      ...overrides,
    }),
    pullResults: [],
    pushes: [],
  };
  return fake;
};
