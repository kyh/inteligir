import type { CloudResult } from "../cloud-client";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import { createSyncRuntime } from "../sync-runtime";
import { agentMessage, createFakeCloud, logRow, ok, userRequest } from "./fakes";

const CRED = { deviceId: "dev_self", credential: `igd_${"a".repeat(64)}` };
const OTHER = "dev_other";

function refused<T>(
  code: "unauthorized" | "sync-conflict",
  deviceSeq: number | null,
): CloudResult<T> {
  return { ok: false, failure: { kind: "refused", code, message: code, deviceSeq } };
}

describe("the sync runtime", () => {
  it("is off until a credential is set, and makes no request while off", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    const runtime = createSyncRuntime({
      store,
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
    });
    expect(runtime.status().state).toBe("off");
    await runtime.syncNow();
    expect(cloud.pushes).toHaveLength(0);
  });

  it("drains the outbox and pulls the log in one pass", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(
      ok({
        events: [
          logRow({
            seq: 1,
            deviceId: OTHER,
            deviceSeq: 0,
            event: agentMessage("thr_x", "t1", "m1", "from desktop"),
          }),
        ],
        lastSeq: 1,
        hasMore: false,
      }),
    );
    const runtime = createSyncRuntime({
      store,
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
    });
    runtime.setCredential(CRED);
    runtime.enqueue([userRequest("thr_x", "hi from phone")]);

    await runtime.syncNow();

    // Pushed the queued event and cleared the outbox…
    expect(cloud.pushes).toHaveLength(1);
    expect(store.countOutbox()).toBe(0);
    // …and applied the desktop's event into the readable thread log.
    expect(store.snapshotThread("thr_x")?.events).toHaveLength(1);
    expect(store.readCursor()).toBe(1);
    expect(runtime.status().state).toBe("paired");
  });

  it("goes unauthorized on a terminal refusal and stops", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(refused("unauthorized", null));
    const runtime = createSyncRuntime({
      store,
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
    });
    runtime.setCredential(CRED);

    await runtime.syncNow();

    const status = runtime.status();
    expect(status.state).toBe("unauthorized");
  });

  it("resets the store on a re-pair — the old account's rows do not carry over", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(
      ok({
        events: [
          logRow({ seq: 4, deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_old", "old") }),
        ],
        lastSeq: 4,
        hasMore: false,
      }),
    );
    const runtime = createSyncRuntime({
      store,
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
    });
    runtime.setCredential(CRED);
    await runtime.syncNow();
    expect(store.snapshotThreads()).toHaveLength(1);

    // A different credential describes a different account — the store clears.
    runtime.setCredential({ deviceId: "dev_new", credential: `igd_${"b".repeat(64)}` });
    expect(store.snapshotThreads()).toHaveLength(0);
    expect(store.readCursor()).toBe(0);
  });

  it("drops the outbox rows a sync-conflict names rather than retrying them", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pushResults.push(refused("sync-conflict", 0));
    const runtime = createSyncRuntime({
      store,
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
    });
    runtime.setCredential(CRED);
    runtime.enqueue([userRequest("thr_x", "doomed")]);

    await runtime.syncNow();

    // The conflicting position is dropped — the log holds a body there this
    // device can never match — so the queue does not wedge.
    expect(store.countOutbox()).toBe(0);
  });
});
