import { planPage } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import type { StoredThread, SyncStore } from "../sync-store";
import { applyPlan } from "../thread-log";
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
  it("folds a snapshot once, and a change to one thread re-folds that thread alone", () => {
    const store = createMemorySyncStore();
    applyPlan(
      store,
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

    applyPlan(
      store,
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

  it("keeps a thread's fold across a page of deltas, which moves only its recency", () => {
    const store = createMemorySyncStore();
    applyPlan(
      store,
      planPage(
        [logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_a", "hi"), seq: 1 })],
        OWN,
      ).steps,
    );
    const before = projectThread(held(store, "thr_a"));

    applyPlan(
      store,
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

  it("previews the last message's first visible line, cut by code point", () => {
    const store = createMemorySyncStore();
    applyPlan(
      store,
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

  it("names a thread by the title its log states, over its first line, and reads its archive", () => {
    const store = createMemorySyncStore();
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
    applyPlan(
      store,
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
});
