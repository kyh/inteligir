import { planPage } from "@repo/api/cloud/sync/plan-page";
import type { PlannedLogRow } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import { applyPlan } from "../thread-log";
import { agentDelta, agentMessage, logRow, userRequest } from "./fakes";

const SELF = "dev_self";
const OTHER = "dev_other";
const OWN = new Set([SELF]);

describe("pull-apply by global seq", () => {
  it("applies another device's rows, moves the cursor, and merges a thread's run", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "hi"), seq: 1 }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 1,
        event: agentMessage("thr_1", "t1", "m1", "hello back"),
        seq: 2,
      }),
    ];
    const plan = planPage(rows, OWN);
    expect(plan.steps).toHaveLength(1);
    applyPlan(store, plan.steps);

    const thread = store.snapshotThread("thr_1");
    expect(thread?.events).toHaveLength(2);
    expect(store.readCursor()).toBe(2);
  });

  it("applies idempotently — the same page twice lands each row once", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "one"), seq: 5 }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 1,
        event: agentMessage("thr_1", "t1", "m1", "two"),
        seq: 6,
      }),
    ];
    applyPlan(store, planPage(rows, OWN).steps);
    applyPlan(store, planPage(rows, OWN).steps);

    expect(store.snapshotThread("thr_1")?.events).toHaveLength(2);
    expect(store.readCursor()).toBe(6);
  });

  it("skips this device's own rows but still advances the cursor past them", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ deviceId: SELF, deviceSeq: 0, event: userRequest("thr_1", "mine"), seq: 10 }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 0,
        event: agentMessage("thr_1", "t1", "m1", "theirs"),
        seq: 11,
      }),
    ];
    applyPlan(store, planPage(rows, OWN).steps);

    expect(store.snapshotThread("thr_1")?.events).toHaveLength(1);
    expect(store.readCursor()).toBe(11);
  });

  it("skips rows under every id the client has signed in as, not only the current one", () => {
    const store = createMemorySyncStore();
    const EARLIER = "dev_self_earlier";
    const rows = [
      logRow({ deviceId: EARLIER, deviceSeq: 0, event: userRequest("thr_1", "old me"), seq: 30 }),
      logRow({ deviceId: SELF, deviceSeq: 0, event: userRequest("thr_1", "me"), seq: 31 }),
      logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "them"), seq: 32 }),
    ];
    applyPlan(store, planPage(rows, new Set([EARLIER, SELF])).steps);

    expect(store.snapshotThread("thr_1")?.events).toHaveLength(1);
    expect(store.readCursor()).toBe(32);
  });

  it("reports and skips a row in a grammar this build does not understand", () => {
    const store = createMemorySyncStore();
    const bad = {
      createdAt: 0,
      deviceId: OTHER,
      deviceSeq: 0,
      event: { type: "nope" },
      seq: 20,
      threadId: "thr_1",
    };
    const plan = planPage([bad], OWN);
    expect(plan.skipped).toHaveLength(1);
    applyPlan(store, plan.steps);
    expect(store.snapshotThread("thr_1")).toBeNull();
    expect(store.readCursor()).toBe(20);
  });
});

describe("the held log", () => {
  it("holds no streaming delta, yet moves the cursor and the thread's recency past it", () => {
    const store = createMemorySyncStore();
    const rows = [
      logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "hi"), seq: 1 }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 1,
        event: agentDelta("thr_1", "t1", "m1", "hel"),
        seq: 2,
      }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 2,
        event: agentDelta("thr_1", "t1", "m1", "lo"),
        seq: 3,
      }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 3,
        event: agentMessage("thr_1", "t1", "m1", "hello"),
        seq: 4,
      }),
      logRow({ deviceId: OTHER, deviceSeq: 4, event: userRequest("thr_2", "later"), seq: 5 }),
      logRow({
        deviceId: OTHER,
        deviceSeq: 5,
        event: agentDelta("thr_1", "t2", "m2", "…"),
        seq: 6,
      }),
    ];
    applyPlan(store, planPage(rows, OWN).steps);

    const thread = store.snapshotThread("thr_1");
    expect(thread?.events.map((event) => event.type)).toStrictEqual([
      "client/turn/requested",
      "item/completed",
    ]);
    expect(thread?.lastSeq).toBe(6);
    expect(store.snapshotThreads().map((held) => held.threadId)).toStrictEqual(["thr_1", "thr_2"]);
    expect(store.readCursor()).toBe(6);
  });

  it("publishes a page of deltas as a new snapshot over the same held events", () => {
    const store = createMemorySyncStore();
    applyPlan(
      store,
      planPage(
        [logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_1", "hi"), seq: 1 })],
        OWN,
      ).steps,
    );
    const before = store.snapshotThread("thr_1");
    applyPlan(
      store,
      planPage(
        [
          logRow({
            deviceId: OTHER,
            deviceSeq: 1,
            event: agentDelta("thr_1", "t1", "m1", "tok"),
            seq: 2,
          }),
        ],
        OWN,
      ).steps,
    );
    const after = store.snapshotThread("thr_1");

    expect(after).not.toBe(before);
    expect(after?.events).toBe(before?.events);
    expect(after?.lastSeq).toBe(2);
  });

  it("keeps a 100k-row streamed backlog to its completed items", () => {
    const store = createMemorySyncStore();
    const total = 100_000;
    const turnRows = 1000;
    const pageRows = 500;
    const eventAt = (seq: number): ThreadEvent => {
      const turn = Math.floor((seq - 1) / turnRows);
      const offset = (seq - 1) % turnRows;
      if (offset === 0) {
        return userRequest("thr_1", `ask ${String(turn)}`);
      }
      return offset === turnRows - 1
        ? agentMessage("thr_1", `t${String(turn)}`, `m${String(turn)}`, "done")
        : agentDelta("thr_1", `t${String(turn)}`, `m${String(turn)}`, "token ");
    };
    for (let first = 1; first <= total; first += pageRows) {
      const rows = Array.from({ length: pageRows }, (_, index): PlannedLogRow => ({
        event: eventAt(first + index),
        origin: { deviceId: OTHER, deviceSeq: first + index },
        seq: first + index,
      }));
      applyPlan(store, [{ kind: "apply", rows, threadId: "thr_1" }]);
    }

    expect(store.readCursor()).toBe(total);
    expect(store.snapshotThread("thr_1")?.events).toHaveLength((2 * total) / turnRows);
  });
});
