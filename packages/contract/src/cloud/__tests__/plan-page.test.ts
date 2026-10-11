import { describe, expect, it } from "vitest";
import { planPage } from "../sync/plan-page";
import type { SyncEventRow } from "../sync/sync-schema";

const SELF = "dev_self";
const OTHER = "dev_other";
const OWN = new Set([SELF]);

const request = (seq: number, deviceId: string): SyncEventRow => ({
  createdAt: 0,
  deviceId,
  deviceSeq: seq,
  event: {
    scope: { kind: "thread" },
    text: `row ${seq}`,
    threadId: "thr_1",
    type: "client/turn/requested",
  },
  seq,
  threadId: "thr_1",
});

// what a newer build pushes: a type this build's grammar has never seen.
const fromANewerBuild = (seq: number): SyncEventRow => ({
  ...request(seq, OTHER),
  event: { scope: { kind: "thread" }, threadId: "thr_1", type: "item/fromANewerBuild" },
});

// what only a buggy or foreign writer pushes: filed under one thread, carrying another's event.
const filedUnderAnotherThread = (seq: number): SyncEventRow => ({
  ...request(seq, OTHER),
  threadId: "thr_2",
});

describe("planPage", () => {
  it("names the lowest row a newer grammar wrote in the skip run that moves past it", () => {
    const plan = planPage(
      [
        request(1, OTHER),
        request(2, SELF),
        fromANewerBuild(3),
        request(4, SELF),
        fromANewerBuild(5),
        request(6, OTHER),
      ],
      OWN,
    );
    expect(
      plan.steps.map((step) =>
        step.kind === "skip"
          ? { cursor: step.cursor, firstUnparsed: step.firstUnparsed }
          : step.kind,
      ),
    ).toEqual(["apply", { cursor: 5, firstUnparsed: 3 }, "apply"]);
    expect(plan.skipped).toHaveLength(2);
  });

  it("skips a row whose envelope and body name different threads, splitting the apply around it", () => {
    const plan = planPage([request(1, OTHER), filedUnderAnotherThread(2), request(3, OTHER)], OWN);
    expect(
      plan.steps.map((step) =>
        step.kind === "skip" ? step : step.rows.map((row) => `${step.threadId}@${row.seq}`),
      ),
    ).toEqual([["thr_1@1"], { cursor: 2, firstUnparsed: null, kind: "skip" }, ["thr_1@3"]]);
    expect(plan.skipped).toEqual([
      "log row 2: filed under thread thr_2 but carries an event for thr_1",
    ]);
  });

  it("names none for a run of this device's own rows, which it already holds", () => {
    const plan = planPage([request(1, SELF), request(2, SELF)], OWN);
    expect(plan.steps).toEqual([{ cursor: 2, firstUnparsed: null, kind: "skip" }]);
    expect(plan.skipped).toEqual([]);
  });
});
