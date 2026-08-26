// The capture inbox, from the phone's side.
//
// TWO HALVES, and the phone lives on the FIRST in a desktop-present account:
//
//   • PRODUCE — `createCapture` POSTs a quick capture to `/v1/capture` with a
//     client-minted idempotency key, so a share-sheet retry after a lost
//     response is one row, not two. This is what quick-capture drives.
//
//   • CLAIM / APPLY / ACK — `runCapturePass` is the CONSUMER half, implemented
//     in full against `@repo/api/cloud/captures/captures-schema`: at-least-once delivery,
//     exactly-once deletion by the owning claim, and an apply that is IDEMPOTENT
//     on the capture id (the applied-capture ledger). It is unit-tested here,
//     and it is what a phone-ONLY account would run — but the default runtime
//     does NOT claim, because the desktop owns application to the vault and a
//     phone claiming would take a capture the desktop then never sees. See the
//     README's "who applies captures".

import type { CaptureRow } from "@repo/api/cloud/captures/captures-schema";
import type { CloudClient, CloudFailure } from "@repo/api/cloud/client";
import type { SyncStore } from "./sync-store";

/** How long an applied capture id is remembered — long enough to cover a lapsed
 *  claim being redelivered to this device, which the contract bounds at five
 *  minutes; a week is slack, not a requirement. */
const APPLIED_CAPTURE_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type CaptureApplyResult = { applied: true } | { applied: false; reason: string };

/** Where a claimed capture lands on this device. Injected: a phone-only build
 *  writes them into a local inbox view, and the unit suite counts the applies. */
export interface CaptureSink {
  apply(captures: readonly CaptureRow[]): Promise<CaptureApplyResult>;
}

export interface CapturePassResult {
  claimed: number;
  applied: number;
  /** Set when the pass ended early on a cloud refusal — the caller decides what
   *  a refusal means for its loop. */
  failure?: CloudFailure;
}

/**
 * Claim the inbox, apply what this device has not applied before, ack.
 *
 * THE ORDER IS THE GUARANTEE: apply commits, THEN the id is recorded, THEN the
 * claim is acked. The window this closes is the contract's own — a claim that
 * lapses after this device applied hands the same capture to whoever claims
 * next, and the ledger makes that second apply a no-op. The window it does NOT
 * close is a crash between the apply and the record: no shared transaction spans
 * the sink and the ledger, so a process dying there re-applies on redelivery.
 * That direction is chosen — a duplicated capture is a line a reader deletes, a
 * lost one is unrecoverable.
 */
export async function runCapturePass(args: {
  client: CloudClient;
  store: SyncStore;
  sink: CaptureSink;
  limit: number;
  now: number;
}): Promise<CapturePassResult> {
  const claimed = await args.client.claimCaptures(args.limit);
  if (!claimed.ok) {
    return { claimed: 0, applied: 0, failure: claimed.failure };
  }
  const captures = claimed.value.captures;
  if (captures.length === 0) {
    return { claimed: 0, applied: 0 };
  }
  const fresh = args.store.filterUnappliedCaptures(captures.map((capture) => capture.id));
  const toApply = captures.filter((capture) => fresh.has(capture.id));
  let applied = 0;
  if (toApply.length > 0) {
    const result = await args.sink.apply(toApply);
    if (!result.applied) {
      // Nothing recorded, nothing acked: the claim lapses and the inbox hands
      // these to whoever claims next.
      return { claimed: captures.length, applied: 0 };
    }
    args.store.recordAppliedCaptures(
      toApply.map((capture) => capture.id),
      args.now,
    );
    applied = toApply.length;
  }
  const acked = await args.client.ackCaptures({
    claimToken: claimed.value.claimToken,
    ids: captures.map((capture) => capture.id),
  });
  if (!acked.ok) {
    return { claimed: captures.length, applied, failure: acked.failure };
  }
  args.store.pruneAppliedCaptures(args.now - APPLIED_CAPTURE_RETENTION_MS);
  return { claimed: captures.length, applied };
}
