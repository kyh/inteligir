import type { CaptureRow } from "@repo/api/cloud/captures/captures-schema";
import { describe, expect, it } from "vitest";
import { runCapturePass, type CaptureApplyResult, type CaptureSink } from "../captures";
import { createMemorySyncStore } from "../memory-sync-store";
import { createFakeCloud, ok } from "./fakes";

function countingSink(): CaptureSink & { applied: CaptureRow[] } {
  const applied: CaptureRow[] = [];
  return {
    applied,
    apply(captures): Promise<CaptureApplyResult> {
      applied.push(...captures);
      return Promise.resolve({ applied: true });
    },
  };
}

const CAP: CaptureRow = { id: "cap_1", text: "buy milk", createdAt: 1 };

describe("the capture inbox applies idempotently on the capture id", () => {
  it("applies a redelivered capture exactly once", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    const sink = countingSink();
    // The SAME capture is delivered on two passes — a claim that lapsed after
    // the first apply hands it to this device again.
    cloud.claimResults.push(ok({ claimToken: "t1", captures: [CAP], expiresAt: 1 }));
    cloud.claimResults.push(ok({ claimToken: "t2", captures: [CAP], expiresAt: 1 }));

    const first = await runCapturePass({ client: cloud.client, store, sink, limit: 10, now: 1000 });
    const second = await runCapturePass({
      client: cloud.client,
      store,
      sink,
      limit: 10,
      now: 2000,
    });

    expect(first.applied).toBe(1);
    expect(second.applied).toBe(0);
    // Applied to the sink once across both deliveries; both passes still ack.
    expect(sink.applied).toHaveLength(1);
    expect(cloud.acks).toHaveLength(2);
  });

  it("does not ack or record when the sink declines to apply", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.claimResults.push(ok({ claimToken: "t1", captures: [CAP], expiresAt: 1 }));
    const failing: CaptureSink = {
      apply: () => Promise.resolve({ applied: false, reason: "inbox write refused" }),
    };

    const result = await runCapturePass({
      client: cloud.client,
      store,
      sink: failing,
      limit: 10,
      now: 1000,
    });

    // Nothing recorded, nothing acked: the claim lapses and the inbox redelivers.
    expect(result.applied).toBe(0);
    expect(cloud.acks).toHaveLength(0);
    expect(store.filterUnappliedCaptures([CAP.id]).has(CAP.id)).toBe(true);
  });
});
