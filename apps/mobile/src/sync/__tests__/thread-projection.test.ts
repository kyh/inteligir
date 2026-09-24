import { planPage } from "@repo/api/cloud/sync/plan-page";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import type { StoredThread, SyncStore } from "../sync-store";
import { applyPlan } from "../thread-log";
import { projectThread } from "../thread-projection";
import { agentMessage, logRow, userRequest } from "./fakes";

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
});
