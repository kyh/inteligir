import { planPage } from "@repo/api/cloud/sync/plan-page";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import { applyPlan } from "../thread-log";
import { agentMessage, logRow, userRequest } from "./fakes";

const SELF = "dev_self";
const OTHER = "dev_other";

describe("pull-apply by global seq", () => {
  it("applies another device's rows, moves the cursor, and merges a thread's run", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ seq: 1, deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "hi") }),
      logRow({
        seq: 2,
        deviceId: OTHER,
        deviceSeq: 1,
        event: agentMessage("thr_1", "t1", "m1", "hello back"),
      }),
    ];
    const plan = planPage(rows, SELF);
    // Consecutive rows for one thread collapse into ONE apply group.
    expect(plan.steps).toHaveLength(1);
    applyPlan(store, plan.steps);

    const thread = store.snapshotThread("thr_1");
    expect(thread?.events).toHaveLength(2);
    expect(store.readCursor()).toBe(2);
  });

  it("applies idempotently — the same page twice lands each row once", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ seq: 5, deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "one") }),
      logRow({
        seq: 6,
        deviceId: OTHER,
        deviceSeq: 1,
        event: agentMessage("thr_1", "t1", "m1", "two"),
      }),
    ];
    applyPlan(store, planPage(rows, SELF).steps);
    applyPlan(store, planPage(rows, SELF).steps);

    expect(store.snapshotThread("thr_1")?.events).toHaveLength(2);
    expect(store.readCursor()).toBe(6);
  });

  it("skips this device's own rows but still advances the cursor past them", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ seq: 10, deviceId: SELF, deviceSeq: 0, event: userRequest("thr_1", "mine") }),
      logRow({
        seq: 11,
        deviceId: OTHER,
        deviceSeq: 0,
        event: agentMessage("thr_1", "t1", "m1", "theirs"),
      }),
    ];
    applyPlan(store, planPage(rows, SELF).steps);

    // Only the other device's event lands; the own row is skipped, yet the
    // cursor sits past both.
    expect(store.snapshotThread("thr_1")?.events).toHaveLength(1);
    expect(store.readCursor()).toBe(11);
  });

  it("reports and skips a row in a grammar this build does not understand", () => {
    const store = createMemorySyncStore();
    const bad = {
      seq: 20,
      threadId: "thr_1",
      deviceId: OTHER,
      deviceSeq: 0,
      event: { type: "nope" },
      createdAt: 0,
    };
    const plan = planPage([bad], SELF);
    expect(plan.skipped).toHaveLength(1);
    applyPlan(store, plan.steps);
    expect(store.snapshotThread("thr_1")).toBeNull();
    expect(store.readCursor()).toBe(20);
  });
});
