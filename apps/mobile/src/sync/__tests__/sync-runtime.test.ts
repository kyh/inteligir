import type { CloudClient, CloudResult } from "@repo/api/cloud/client";
import type { DeviceCredential, RevokeDeviceResponse } from "@repo/api/cloud/device/device-schema";
import type { PullResponse } from "@repo/api/cloud/sync/sync-schema";
import { MAX_PULL_PAGES_PER_PASS } from "@repo/api/cloud/sync/sync-session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSyncStore } from "../../notes/__tests__/phone-storage";
import { createSyncRuntime } from "../sync-runtime";
import type { SyncRuntime, SyncStatus } from "../sync-runtime";
import { agentMessage, createFakeCloud, logRow, ok, userRequest } from "./fakes";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };
const OTHER = "dev_other";

const UNAUTHORIZED: CloudResult<PullResponse> = {
  failure: { code: "unauthorized", deviceSeq: null, kind: "refused", message: "unauthorized" },
  ok: false,
};

const UNREACHABLE: CloudResult<PullResponse> = {
  failure: { kind: "unreachable", message: "offline" },
  ok: false,
};

const EMPTY_PAGE: CloudResult<PullResponse> = ok({ events: [], hasMore: false, lastSeq: 0 });

const UNREACHABLE_SIGN_OUT: CloudResult<RevokeDeviceResponse> = {
  failure: { kind: "unreachable", message: "offline" },
  ok: false,
};

afterEach(() => {
  vi.useRealTimers();
});

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
  it("is restoring until a credential is handed over, and makes no request meanwhile", async () => {
    const store = openSyncStore();
    const cloud = createFakeCloud();
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    expect(runtime.get()).toStrictEqual({ state: "restoring" });
    await runtime.syncNow();
    expect(cloud.pushes).toHaveLength(0);

    runtime.setCredential(null);
    expect(runtime.get()).toStrictEqual({ state: "signed-out" });
  });

  it("pulls the log, and neither pushes nor claims — both halves are the desktop's", async () => {
    const store = openSyncStore();
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
    const store = openSyncStore();
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

  it("publishes a poll pass — the snapshot moves with no caller on this side", async () => {
    const store = openSyncStore();
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

  it("drains a backlog past one pass's cap in one sync, and says synced only at its end", async () => {
    const store = openSyncStore();
    const cloud = createFakeCloud();
    const pages = MAX_PULL_PAGES_PER_PASS + 5;
    for (let seq = 1; seq <= pages; seq += 1) {
      cloud.pullResults.push(
        ok({
          events: [
            logRow({ deviceId: OTHER, deviceSeq: seq, event: userRequest("thr_x", `${seq}`), seq }),
          ],
          hasMore: seq < pages,
          lastSeq: pages,
        }),
      );
    }
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);
    const seen: SyncStatus[] = [];
    const unsubscribe = runtime.subscribe(() => {
      seen.push(runtime.get());
    });

    await runtime.syncNow();
    unsubscribe();

    expect(store.readCursor()).toBe(pages);
    const catchingUp = seen.filter(
      (status) => status.state === "signed-in" && status.cursor < pages,
    );
    expect(catchingUp.length).toBeGreaterThan(MAX_PULL_PAGES_PER_PASS);
    expect(catchingUp).not.toContainEqual(
      expect.objectContaining({ lastSyncedAt: expect.any(Number) }),
    );
    expect(runtime.get()).toMatchObject({ cursor: pages, lastSyncedAt: expect.any(Number) });
  });

  it("does not call an unreachable pull synced", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const store = openSyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(EMPTY_PAGE, UNREACHABLE);
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);
    await runtime.syncNow();
    expect(runtime.get()).toMatchObject({ lastSyncedAt: 1_000_000 });

    vi.setSystemTime(2_000_000);
    await runtime.syncNow();

    expect(runtime.get()).toMatchObject({
      lastError: expect.stringContaining("offline"),
      lastSyncedAt: 1_000_000,
      state: "signed-in",
    });
  });

  it("lands a revocation on the next poll pass — unauthorized, with no pull-to-refresh", async () => {
    const store = openSyncStore();
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

  it("ends the sign-in when a capture is refused as unauthorized", async () => {
    const store = openSyncStore();
    const cloud = createFakeCloud();
    cloud.captureResults.push({
      failure: { code: "unauthorized", deviceSeq: null, kind: "refused", message: "unauthorized" },
      ok: false,
    });
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);

    const result = await runtime.createCapture({ idempotencyKey: "k".repeat(16), text: "idea" });

    expect(result.ok).toBe(false);
    expect(runtime.get()).toMatchObject({ deviceId: CRED.deviceId, state: "unauthorized" });
  });

  it("hands its diagnostics to the injected sink — a row this build cannot read is named", async () => {
    const store = openSyncStore();
    const cloud = createFakeCloud();
    cloud.pullResults.push(
      ok({
        events: [
          {
            createdAt: 0,
            deviceId: OTHER,
            deviceSeq: 0,
            event: { type: "future/event" },
            seq: 7,
            threadId: "thr_x",
          },
        ],
        hasMore: false,
        lastSeq: 7,
      }),
    );
    const debugged: string[] = [];
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      onDebug: (message) => {
        debugged.push(message);
      },
      pollIntervalMs: null,
      store,
    });
    runtime.setCredential(CRED);

    await runtime.syncNow();

    expect(debugged).toEqual(["log row 7: not a thread event this build understands"]);
  });
});

// one fake cloud answers every credential; this records which one each sign-out came from
const recordingSignOuts = () => {
  const cloud = createFakeCloud();
  const signedOut: string[] = [];
  const createClient = (credential: DeviceCredential): CloudClient => ({
    ...cloud.client,
    signOut: async () => {
      signedOut.push(credential.deviceId);
      return await cloud.client.signOut();
    },
  });
  const runtime = createSyncRuntime({
    cloudUrl: "https://cloud.test",
    createClient,
    pollIntervalMs: null,
    store: openSyncStore(),
  });
  return { cloud, runtime, signedOut };
};

describe("dropping a credential", () => {
  const NEXT = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_next" };

  it("signs it out, so the account's device slot comes back", () => {
    const { runtime, signedOut } = recordingSignOuts();
    runtime.setCredential(CRED);
    expect(signedOut).toEqual([]);

    runtime.setCredential(null);
    expect(signedOut).toEqual([CRED.deviceId]);
    expect(runtime.get()).toStrictEqual({ state: "signed-out" });
  });

  it("signs the previous one out when another replaces it, and never the one it keeps", () => {
    const { runtime, signedOut } = recordingSignOuts();
    runtime.setCredential(CRED);
    runtime.setCredential(NEXT);
    runtime.setCredential(NEXT);
    expect(signedOut).toEqual([CRED.deviceId]);
  });

  it("signs out here even when the cloud cannot hear it", () => {
    const cloud = createFakeCloud();
    const runtime = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => ({ ...cloud.client, signOut: async () => await UNREACHABLE_SIGN_OUT }),
      pollIntervalMs: null,
      store: openSyncStore(),
    });
    runtime.setCredential(CRED);
    runtime.setCredential(null);
    expect(runtime.get()).toStrictEqual({ state: "signed-out" });
  });

  it("asks nothing of the cloud for a credential it already refused", async () => {
    const { cloud, runtime, signedOut } = recordingSignOuts();
    cloud.pullResults.push(UNAUTHORIZED);
    runtime.setCredential(CRED);
    await runtime.syncNow();
    expect(runtime.get().state).toBe("unauthorized");

    runtime.setCredential(null);
    expect(signedOut).toEqual([]);
  });
});
