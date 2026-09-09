import type { CloudResult } from "@repo/api/cloud/client";
import type { PullResponse } from "@repo/api/cloud/sync/sync-schema";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../memory-sync-store";
import { createSyncRuntime } from "../sync-runtime";
import type { SyncRuntime, SyncStatus } from "../sync-runtime";
import { agentMessage, createFakeCloud, logRow, ok, userRequest } from "./fakes";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };
const OTHER = "dev_other";

const UNAUTHORIZED: CloudResult<PullResponse> = {
  failure: { code: "unauthorized", deviceSeq: null, kind: "refused", message: "unauthorized" },
  ok: false,
};

const EMPTY_PAGE: CloudResult<PullResponse> = ok({ events: [], hasMore: false, lastSeq: 0 });

const published = async (
  runtime: SyncRuntime,
  done: (status: SyncStatus) => boolean,
): Promise<SyncStatus> =>
  // oxlint-disable-next-line promise/avoid-new -- the status arrives as a store notification, which only a promise can hand to an await
  await new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const check = (): void => {
      const status = runtime.get();
      if (!done(status)) {
        return;
      }
      unsubscribe?.();
      resolve(status);
    };
    unsubscribe = runtime.subscribe(check);
    check();
  });

describe("the sync runtime", () => {
  it("is off until a credential is set, and makes no request while off", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    expect(runtime.get().state).toBe("signed-out");
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
            deviceId: OTHER,
            deviceSeq: 0,
            event: agentMessage("thr_x", "t1", "m1", "from desktop"),
            seq: 1,
          }),
        ],
        hasMore: false,
        lastSeq: 1,
      }),
    );
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);

    await runtime.syncNow();

    expect(store.snapshotThread("thr_x")?.events).toHaveLength(1);
    expect(store.readCursor()).toBe(1);
    expect(runtime.get()).toMatchObject({ cursor: 1, lastError: null, state: "signed-in" });
    expect(cloud.pushes).toHaveLength(0);
    expect(cloud.claims).toBe(0);
  });

  it("goes unauthorized on a terminal refusal and stops", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(UNAUTHORIZED);
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);

    await runtime.syncNow();

    expect(runtime.get().state).toBe("unauthorized");
  });

  it("resets the store when signing in again — the old account's rows do not carry over", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(
      ok({
        events: [
          logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_old", "old"), seq: 4 }),
        ],
        hasMore: false,
        lastSeq: 4,
      }),
    );
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);
    await runtime.syncNow();
    expect(store.snapshotThreads()).toHaveLength(1);

    runtime.setCredential({ credential: `igd_${"b".repeat(64)}`, deviceId: "dev_new" });
    expect(store.snapshotThreads()).toHaveLength(0);
    expect(store.readCursor()).toBe(0);
    expect(runtime.get()).toMatchObject({ cursor: 0, deviceId: "dev_new", state: "signed-in" });

    runtime.setCredential(null);
    expect(runtime.get()).toStrictEqual({ state: "signed-out" });
  });

  it("publishes a poll pass — the snapshot moves with no caller on this side", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(
      EMPTY_PAGE,
      ok({
        events: [
          logRow({
            deviceId: OTHER,
            deviceSeq: 0,
            event: agentMessage("thr_x", "t1", "m1", "landed in the background"),
            seq: 1,
          }),
        ],
        hasMore: false,
        lastSeq: 1,
      }),
    );
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: 5,
      store,
    });
    runtime.setCredential(CRED);
    runtime.start();

    const booted = await published(
      runtime,
      (status) => status.state === "signed-in" && status.lastSyncedAt !== null,
    );
    expect(booted).toMatchObject({ cursor: 0, state: "signed-in" });
    // identity, not equality: a snapshot rebuilt per read loops useSyncExternalStore.
    expect(runtime.get()).toBe(booted);

    const polled = await published(
      runtime,
      (status) => status.state === "signed-in" && status.cursor === 1,
    );
    expect(polled).toMatchObject({ cursor: 1, lastError: null, state: "signed-in" });
    expect(store.snapshotThread("thr_x")?.events).toHaveLength(1);

    runtime.setCredential(null);
  });

  it("lands a revocation on the next poll pass — unauthorized, with no pull-to-refresh", async () => {
    const store = createMemorySyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(EMPTY_PAGE, UNAUTHORIZED);
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: 5,
      store,
    });
    runtime.setCredential(CRED);
    runtime.start();

    const revoked = await published(runtime, (status) => status.state === "unauthorized");
    expect(revoked).toMatchObject({ deviceId: CRED.deviceId, state: "unauthorized" });
  });
});
