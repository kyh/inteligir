import { planPage } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { nodeSha1, openTempDb } from "../../notes/__tests__/phone-storage";
import { createLiveTurns } from "../live-turns";
import { createSqliteSyncStore } from "../sqlite-sync-store";
import { agentDelta, agentMessage, logRow } from "./fakes";

const started = (threadId: string, turnId: string, id: string): ThreadEvent => ({
  item: { id, text: "", type: "agentMessage" },
  scope: turnScope(turnId),
  threadId,
  type: "item/started",
});

const thinking = (threadId: string, turnId: string, id: string): ThreadEvent => ({
  item: { content: [], id, summary: [], type: "reasoning" },
  scope: turnScope(turnId),
  threadId,
  type: "item/started",
});

const thought = (
  type: "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta",
  itemId: string,
  delta: string,
): ThreadEvent => ({ delta, itemId, scope: turnScope("t1"), threadId: "thr_x", type });

const turnCompleted = (threadId: string, turnId: string): ThreadEvent => ({
  scope: turnScope(turnId),
  status: "completed",
  threadId,
  type: "turn/completed",
});

describe("a running turn's live rows", () => {
  it("fold an item's deltas as they land", () => {
    const live = createLiveTurns();
    live.apply([started("thr_x", "t1", "m1"), agentDelta("thr_x", "t1", "m1", "Hel")]);
    expect(live.snapshot("thr_x")).toEqual([{ id: "m1", kind: "agent", text: "Hel" }]);

    live.apply([agentDelta("thr_x", "t1", "m1", "lo")]);
    expect(live.snapshot("thr_x")).toEqual([{ id: "m1", kind: "agent", text: "Hello" }]);
  });

  it("show the reasoning summary as the settled row does, else the thought itself", () => {
    const live = createLiveTurns();
    live.apply([
      thinking("thr_x", "t1", "r1"),
      thought("item/reasoning/textDelta", "r1", "weighing it"),
      thinking("thr_x", "t1", "r2"),
      thought("item/reasoning/textDelta", "r2", "raw"),
      thought("item/reasoning/summaryTextDelta", "r2", "Summary"),
    ]);

    expect(live.snapshot("thr_x")).toEqual([
      { id: "r1", kind: "reasoning", text: "weighing it" },
      { id: "r2", kind: "reasoning", text: "Summary" },
    ]);
  });

  it("give an item up to its item/completed, and ignore a delta for it after", () => {
    const live = createLiveTurns();
    live.apply([
      started("thr_x", "t1", "m1"),
      agentDelta("thr_x", "t1", "m1", "Hel"),
      started("thr_x", "t1", "m2"),
      agentDelta("thr_x", "t1", "m2", "Next"),
      agentMessage("thr_x", "t1", "m1", "Hello"),
    ]);
    expect(live.snapshot("thr_x")).toEqual([{ id: "m2", kind: "agent", text: "Next" }]);

    live.apply([agentDelta("thr_x", "t1", "m1", " again")]);
    expect(live.snapshot("thr_x")).toEqual([{ id: "m2", kind: "agent", text: "Next" }]);
  });

  it("clear a turn's items when it completes, and leave another thread's", () => {
    const live = createLiveTurns();
    live.apply([
      started("thr_x", "t1", "m1"),
      agentDelta("thr_x", "t1", "m1", "cut short"),
      started("thr_y", "t9", "m9"),
      agentDelta("thr_y", "t9", "m9", "still going"),
      turnCompleted("thr_x", "t1"),
    ]);

    expect(live.snapshot("thr_x")).toEqual([]);
    expect(live.snapshot("thr_y")).toEqual([{ id: "m9", kind: "agent", text: "still going" }]);
  });

  it("clear everything on a reset", () => {
    const live = createLiveTurns();
    live.apply([started("thr_x", "t1", "m1"), agentDelta("thr_x", "t1", "m1", "gone")]);
    live.reset();
    expect(live.snapshot("thr_x")).toEqual([]);
  });

  it("draw nothing for an item this launch never saw start: its head was pulled before", () => {
    const live = createLiveTurns();
    live.apply([agentDelta("thr_x", "t1", "m1", "the tail")]);
    expect(live.snapshot("thr_x")).toEqual([]);
  });

  it("keep a thread's snapshot until it moves, and notify once per page", () => {
    const live = createLiveTurns();
    let notified = 0;
    live.subscribe(() => {
      notified += 1;
    });
    live.apply([
      started("thr_x", "t1", "m1"),
      agentDelta("thr_x", "t1", "m1", "a"),
      agentDelta("thr_x", "t1", "m1", "b"),
    ]);
    const first = live.snapshot("thr_x");
    expect(live.snapshot("thr_x")).toBe(first);
    const quiet = live.snapshot("thr_y");

    live.apply([agentDelta("thr_x", "t1", "m1", "c")]);

    expect(notified).toBe(2);
    expect(live.snapshot("thr_x")).not.toBe(first);
    expect(live.snapshot("thr_y")).toBe(quiet);
  });
});

describe("the store feeding the live rows", () => {
  const rows = [
    logRow({ deviceId: "dev_mac", deviceSeq: 0, event: started("thr_x", "t1", "m1"), seq: 1 }),
    logRow({
      deviceId: "dev_mac",
      deviceSeq: 1,
      event: agentDelta("thr_x", "t1", "m1", "Hel"),
      seq: 2,
    }),
  ];

  it("folds each landed row once, a page pulled twice included", async () => {
    const live = createLiveTurns();
    const store = createSqliteSyncStore({ db: openTempDb(), live, sha1: nodeSha1 });
    await store.reset("signed-in");
    const own = new Set(["dev_phone"]);

    await store.applyPlan(planPage(rows, own).steps);
    await store.applyPlan(planPage(rows, own).steps);

    expect(live.snapshot("thr_x")).toEqual([{ id: "m1", kind: "agent", text: "Hel" }]);
  });

  it("drops them with the threads on a reset", async () => {
    const live = createLiveTurns();
    const store = createSqliteSyncStore({ db: openTempDb(), live, sha1: nodeSha1 });
    await store.reset("signed-in");
    await store.applyPlan(planPage(rows, new Set(["dev_phone"])).steps);

    await store.reset(null);

    expect(live.snapshot("thr_x")).toEqual([]);
  });
});
