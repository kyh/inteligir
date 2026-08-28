import type { CloudResult } from "@repo/api/cloud/client";
import type { PullResponse } from "@repo/api/cloud/sync/sync-schema";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import { createSyncRuntime } from "../sync-runtime";
import { agentMessage, createFakeCloud, logRow, ok, userRequest } from "./fakes";

const CRED = { deviceId: "dev_self", credential: `igd_${"a".repeat(64)}` };
const OTHER = "dev_other";

const UNAUTHORIZED: CloudResult<PullResponse> = {
  ok: false,
  failure: { kind: "refused", code: "unauthorized", message: "unauthorized", deviceSeq: null },
};

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

  it("pulls the log, and neither pushes nor claims — both halves are the desktop's", async () => {
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

    await runtime.syncNow();

    expect(store.snapshotThread("thr_x")?.events).toHaveLength(1);
    expect(store.readCursor()).toBe(1);
    expect(runtime.status().state).toBe("paired");
    // The phone produces no thread event and applies no capture to a vault it
    // does not have, so a pass touches neither route.
    expect(cloud.pushes).toHaveLength(0);
    expect(cloud.claims).toBe(0);
  });

  it("goes unauthorized on a terminal refusal and stops", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(UNAUTHORIZED);
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
});
