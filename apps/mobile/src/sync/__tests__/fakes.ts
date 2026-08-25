// In-memory fakes for the sync client's unit suite — a programmable CloudClient
// and builders for the thread events / log rows the wire carries. Nothing here
// touches a network or a native module; the pure logic is what is exercised.

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
import type { CloudClient, CloudResult } from "../cloud-client";

export function userRequest(threadId: string, text: string): ThreadEvent {
  return { type: "client/turn/requested", threadId, text, kind: "message", scope: threadScope() };
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

/** A merged-log row, as the pull hands it back. */
export function logRow(args: {
  seq: number;
  deviceId: string;
  deviceSeq: number;
  event: ThreadEvent;
}): SyncEventRow {
  // SAFETY: a ThreadEvent is valid JSON, so it is exactly what the wire carries
  // in the row's opaque `event` field — planPage re-parses it through
  // threadEventSchema at the boundary, which is where the real narrowing happens.
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

/** A CloudClient whose every method reads from a queue the test fills, and
 *  records what it was called with. A queue that runs dry answers a sensible
 *  default (empty pull, empty claim) so a pass can settle. */
export interface FakeCloud {
  client: CloudClient;
  pushes: PushRequest[];
  captures: CaptureRequest[];
  claims: number;
  acks: AckCapturesRequest[];
  pushResults: CloudResult<PushResponse>[];
  pullResults: CloudResult<PullResponse>[];
  claimResults: CloudResult<ClaimCapturesResponse>[];
  ackResults: CloudResult<AckCapturesResponse>[];
  captureResults: CloudResult<CaptureResponse>[];
}

export function createFakeCloud(): FakeCloud {
  const fake: FakeCloud = {
    pushes: [],
    captures: [],
    claims: 0,
    acks: [],
    pushResults: [],
    pullResults: [],
    claimResults: [],
    ackResults: [],
    captureResults: [],
    client: {
      push: (request) => {
        fake.pushes.push(request);
        return Promise.resolve(
          fake.pushResults.shift() ??
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
        return Promise.resolve(
          fake.claimResults.shift() ?? ok({ claimToken: "tok", captures: [], expiresAt: 1 }),
        );
      },
      ackCaptures: (request) => {
        fake.acks.push(request);
        return Promise.resolve(
          fake.ackResults.shift() ??
            ok({ results: request.ids.map((id) => ({ id, outcome: "deleted" as const })) }),
        );
      },
      // The sync runtime never reads the vault; the notes-store suite fakes
      // its own client. An empty vault is the honest inert answer here.
      vaultTree: () => Promise.resolve(ok({ commit: "0".repeat(40), entries: [], next: null })),
      vaultFile: () =>
        Promise.resolve<CloudResult<VaultFileResponse>>({
          ok: false,
          failure: { kind: "refused", code: "not-found", message: "empty fake", deviceSeq: null },
        }),
    },
  };
  return fake;
}
