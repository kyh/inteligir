import { planPage } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { threadListEntries, WORKING_CAPTION } from "../../dispatch/dispatch-projection";
import type { DispatchState } from "../../dispatch/dispatch-runtime";
import { openSyncStore } from "../../notes/__tests__/phone-storage";
import type { StoredThread, SyncStore } from "../sync-store";
import { liveThreadsFirst, projectThread } from "../thread-projection";
import { agentDelta, agentMessage, logRow, userRequest } from "./fakes";

const OTHER = "dev_other";
const OWN = new Set(["dev_self"]);

const held = (store: SyncStore, threadId: string): StoredThread => {
  const thread = store.snapshotThread(threadId);
  if (thread === null) {
    throw new Error(`${threadId} is not held`);
  }
  return thread;
};

describe("the thread projection", () => {
  it("folds a snapshot once, and a change to one thread re-folds that thread alone", async () => {
    const store = openSyncStore();
    await store.applyPlan(
      planPage(
        [
          logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_a", "first"), seq: 1 }),
          logRow({ deviceId: OTHER, deviceSeq: 1, event: userRequest("thr_b", "second"), seq: 2 }),
        ],
        OWN,
      ).steps,
    );
    const foldedA = projectThread(held(store, "thr_a"));
    const foldedB = projectThread(held(store, "thr_b"));
    expect(projectThread(held(store, "thr_a"))).toBe(foldedA);

    await store.applyPlan(
      planPage(
        [
          logRow({
            deviceId: OTHER,
            deviceSeq: 2,
            event: agentMessage("thr_b", "t1", "m1", "answer"),
            seq: 3,
          }),
        ],
        OWN,
      ).steps,
    );

    expect(projectThread(held(store, "thr_a"))).toBe(foldedA);
    const refolded = projectThread(held(store, "thr_b"));
    expect(refolded).not.toBe(foldedB);
    expect(refolded.preview).toBe("answer");
  });

  it("keeps a thread's fold across a page of deltas, which moves only its recency", async () => {
    const store = openSyncStore();
    await store.applyPlan(
      planPage(
        [logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_a", "hi"), seq: 1 })],
        OWN,
      ).steps,
    );
    const before = projectThread(held(store, "thr_a"));

    await store.applyPlan(
      planPage(
        [
          logRow({
            deviceId: OTHER,
            deviceSeq: 1,
            event: agentDelta("thr_a", "t1", "m1", "tok"),
            seq: 2,
          }),
        ],
        OWN,
      ).steps,
    );

    expect(held(store, "thr_a").lastSeq).toBe(2);
    expect(projectThread(held(store, "thr_a"))).toBe(before);
  });

  it("previews the last message's first visible line, cut by code point", async () => {
    const store = openSyncStore();
    await store.applyPlan(
      planPage(
        [
          logRow({
            deviceId: OTHER,
            deviceSeq: 0,
            event: agentMessage("thr_a", "t1", "m1", "\n\n  first words\nmore"),
            seq: 1,
          }),
          logRow({
            deviceId: OTHER,
            deviceSeq: 1,
            event: agentMessage("thr_b", "t1", "m2", "😀".repeat(61)),
            seq: 2,
          }),
        ],
        OWN,
      ).steps,
    );

    expect(projectThread(held(store, "thr_a")).preview).toBe("first words");
    expect(projectThread(held(store, "thr_b")).preview).toBe(`${"😀".repeat(59)}…`);
  });

  it("names a thread by the title its log states, over its first line, and reads its archive", async () => {
    const store = openSyncStore();
    const stated: ThreadEvent = {
      scope: threadScope(),
      threadId: "thr_a",
      title: "Plan the week",
      type: "thread/meta",
    };
    const archived: ThreadEvent = {
      scope: threadScope(),
      threadId: "thr_a",
      type: "thread/archived",
    };
    await store.applyPlan(
      planPage(
        [
          logRow({
            deviceId: OTHER,
            deviceSeq: 0,
            event: userRequest("thr_a", "draft it"),
            seq: 1,
          }),
          logRow({ deviceId: OTHER, deviceSeq: 1, event: stated, seq: 2 }),
          logRow({
            deviceId: OTHER,
            deviceSeq: 2,
            event: userRequest("thr_b", "older log"),
            seq: 3,
          }),
          logRow({ deviceId: OTHER, deviceSeq: 3, event: archived, seq: 4 }),
        ],
        OWN,
      ).steps,
    );

    const named = projectThread(held(store, "thr_a"));
    expect(named).toMatchObject({ archived: true, preview: "draft it", title: "Plan the week" });
    const older = projectThread(held(store, "thr_b"));
    expect(older).toMatchObject({ archived: false, title: "older log" });
    expect(
      liveThreadsFirst(store.snapshotThreads().map((thread) => projectThread(thread))).map(
        (thread) => thread.threadId,
      ),
    ).toEqual(["thr_b", "thr_a"]);
  });

  it("is running from a turn's start until that turn completes, and says so in the list", async () => {
    const store = openSyncStore();
    const started: ThreadEvent = {
      scope: turnScope("t1"),
      threadId: "thr_a",
      type: "turn/started",
    };
    const completed: ThreadEvent = {
      scope: turnScope("t1"),
      status: "completed",
      threadId: "thr_a",
      type: "turn/completed",
    };
    const idle: DispatchState = { approvals: [], desktops: null, dispatches: [] };
    await store.applyPlan(
      planPage(
        [
          logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_a", "go"), seq: 1 }),
          logRow({ deviceId: OTHER, deviceSeq: 1, event: started, seq: 2 }),
        ],
        OWN,
      ).steps,
    );
    const working = projectThread(held(store, "thr_a"));
    expect(working.running).toBe(true);
    expect(threadListEntries([working], idle)).toStrictEqual([
      { caption: WORKING_CAPTION, threadId: "thr_a", title: "go" },
    ]);

    await store.applyPlan(
      planPage(
        [
          logRow({
            deviceId: OTHER,
            deviceSeq: 2,
            event: agentMessage("thr_a", "t1", "m1", "done"),
            seq: 3,
          }),
          logRow({ deviceId: OTHER, deviceSeq: 3, event: completed, seq: 4 }),
        ],
        OWN,
      ).steps,
    );
    const finished = projectThread(held(store, "thr_a"));
    expect(finished.running).toBe(false);
    expect(threadListEntries([finished], idle)).toStrictEqual([
      { caption: "done", threadId: "thr_a", title: "go" },
    ]);
  });

  it("lists a thread only this phone holds so far, first and named by its first message", async () => {
    const store = openSyncStore();
    await store.applyPlan(
      planPage(
        [logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_a", "old"), seq: 1 })],
        OWN,
      ).steps,
    );
    const pending: DispatchState = {
      approvals: [],
      desktops: { declining: 0, listening: 1 },
      dispatches: [
        {
          createdAt: 1,
          id: "1".repeat(32),
          kind: "turn",
          phase: { kind: "waiting" },
          text: "\n  Plan the offsite\nwith the team",
          threadId: "thr_phone",
        },
        {
          createdAt: 2,
          id: "2".repeat(32),
          kind: "turn",
          phase: { error: "offline", kind: "unsent" },
          text: "and book a room",
          threadId: "thr_phone",
        },
      ],
    };

    expect(
      threadListEntries(
        store.snapshotThreads().map((thread) => projectThread(thread)),
        pending,
      ),
    ).toStrictEqual([
      { caption: "Not sent yet — retrying", threadId: "thr_phone", title: "Plan the offsite" },
      { caption: "old", threadId: "thr_a", title: "old" },
    ]);
  });
});
