import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import { ackPushBatch, enqueueThreadEvents, takePushBatch } from "../outbox";
import { agentMessage, userRequest } from "./fakes";

describe("the outbox freezes bytes at enqueue", () => {
  it("stores JSON.stringify(event) once, and the batch carries those bytes back", () => {
    const store = createMemorySyncStore();
    const event = userRequest("thr_1", "hello");
    enqueueThreadEvents(store, [event], 100);

    const rows = store.listOutbox(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe(JSON.stringify(event));
    expect(rows[0]?.deviceSeq).toBe(0);

    const batch = takePushBatch(store);
    expect(batch?.request.events).toHaveLength(1);
    // The pushed body is the STORED bytes parsed straight back, not a rebuilt
    // domain value — that is what makes a retry byte-identical.
    expect(batch?.request.events[0]?.event).toStrictEqual(JSON.parse(rows[0]?.body ?? ""));
    expect(batch?.throughDeviceSeq).toBe(0);
  });

  it("advances the per-device counter across enqueues and never rewinds after an ack", () => {
    const store = createMemorySyncStore();
    enqueueThreadEvents(
      store,
      [userRequest("thr_1", "a"), agentMessage("thr_1", "turn_1", "m1", "b")],
      0,
    );
    expect(store.listOutbox(10).map((row) => row.deviceSeq)).toStrictEqual([0, 1]);

    // Ack the whole batch, then enqueue again: the next position is 2, not 0 —
    // a counter over the shrinking queue would reuse a position the log holds.
    store.deleteOutboxThrough(1);
    enqueueThreadEvents(store, [userRequest("thr_1", "c")], 0);
    expect(store.listOutbox(10).map((row) => row.deviceSeq)).toStrictEqual([2]);
  });

  it("leaves an over-ceiling event out of the request but inside the batch high-water", () => {
    const store = createMemorySyncStore();
    const oversize = agentMessage("thr_1", "turn_1", "big", "x".repeat(70_000));
    enqueueThreadEvents(store, [oversize, userRequest("thr_1", "ok")], 0);

    const batch = takePushBatch(store);
    // The good event ships; the oversize one is rejected, not retried — but the
    // high-water still covers it, so the ack drops it and it never wedges the row
    // behind it.
    expect(batch?.request.events).toHaveLength(1);
    expect(batch?.rejected).toHaveLength(1);
    expect(batch?.rejected[0]?.deviceSeq).toBe(0);
    expect(batch?.throughDeviceSeq).toBe(1);

    if (batch !== null) ackPushBatch(store, batch);
    expect(store.countOutbox()).toBe(0);
  });
});
