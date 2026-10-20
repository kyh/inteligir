import type { CloudClient, CloudResult } from "@repo/contract/cloud/client";
import type {
  DeviceCredential,
  ListDevicesResponse,
  RevokeDeviceResponse,
} from "@repo/contract/cloud/device/device-schema";
import type { OpenCloudSocketArgs } from "@repo/contract/cloud/sync/cloud-socket";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "@repo/contract/cloud/sync/sync-ws";
import { TEST_BUILD } from "@repo/contract/cloud/test-support/fake-cloud-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, nextTask } from "../test-support/async";
import { createSyncRuntime } from "./sync-runtime";
import type { SyncRuntime, SyncStatus } from "./sync-runtime";
import { createFakeCloud } from "./test-support/fake-cloud";
import type { FakeCloud } from "./test-support/fake-cloud";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };

const UNAUTHORIZED: CloudResult<ListDevicesResponse> = {
  failure: { code: "unauthorized", kind: "refused", message: "unauthorized" },
  ok: false,
};

const OUTDATED: CloudResult<ListDevicesResponse> = {
  failure: { code: "client-outdated", kind: "refused", message: "update" },
  ok: false,
};

const UNREACHABLE: CloudResult<ListDevicesResponse> = {
  failure: { kind: "unreachable", message: "offline" },
  ok: false,
};

const UNREACHABLE_SIGN_OUT: CloudResult<RevokeDeviceResponse> = {
  failure: { kind: "unreachable", message: "offline" },
  ok: false,
};

afterEach(() => {
  vi.useRealTimers();
});

// told on the notification itself, not polled: a status a 5ms timer moves past would be missed
const published = async (
  runtime: SyncRuntime,
  done: (status: SyncStatus) => boolean,
): Promise<SyncStatus> => {
  const seen = deferred<SyncStatus>();
  const check = (): void => {
    const status = runtime.get();
    if (done(status)) {
      seen.resolve(status);
    }
  };
  const unsubscribe = runtime.subscribe(check);
  check();
  try {
    return await seen.promise;
  } finally {
    unsubscribe();
  }
};

const runtimeOver = (
  cloud: FakeCloud,
  overrides: { pollIntervalMs?: number | null; onDebug?: (message: string) => void } = {},
): SyncRuntime =>
  createSyncRuntime({
    build: TEST_BUILD,
    cloudUrl: "https://cloud.test",
    createClient: () => cloud.client,
    pollIntervalMs: null,
    ...overrides,
  });

describe("the sync runtime", () => {
  it("is restoring until a credential is handed over, and makes no request meanwhile", async () => {
    const cloud = createFakeCloud();
    const runtime = runtimeOver(cloud);
    expect(runtime.get()).toStrictEqual({ state: "restoring" });
    runtime.start();
    await nextTask();
    expect(cloud.checks).toBe(0);

    runtime.setCredential(null);
    expect(runtime.get()).toStrictEqual({ state: "signed-out" });
  });

  it("is signed in as the device it was handed, and checks the sign-in as it starts", async () => {
    const cloud = createFakeCloud();
    const runtime = runtimeOver(cloud);
    runtime.setCredential(CRED);
    expect(runtime.get()).toStrictEqual({ deviceId: CRED.deviceId, state: "signed-in" });

    runtime.start();
    await nextTask();

    expect(cloud.checks).toBe(1);
    expect(runtime.get()).toStrictEqual({ deviceId: CRED.deviceId, state: "signed-in" });
  });

  it("goes unauthorized when the check is refused", async () => {
    const cloud = createFakeCloud();
    cloud.checkResults.push(UNAUTHORIZED);
    const runtime = runtimeOver(cloud);
    runtime.setCredential(CRED);
    runtime.start();

    const revoked = await published(runtime, (status) => status.state === "unauthorized");
    expect(revoked).toMatchObject({ deviceId: CRED.deviceId, state: "unauthorized" });
  });

  it("goes outdated when the cloud refuses this build, keeps the sign-in and asks nothing more", async () => {
    const cloud = createFakeCloud();
    cloud.checkResults.push(OUTDATED);
    const runtime = runtimeOver(cloud);
    runtime.setCredential(CRED);
    runtime.start();

    await published(runtime, (status) => status.state === "outdated");
    runtime.resume();
    runtime.start();
    await nextTask();

    expect(runtime.get()).toStrictEqual({ deviceId: CRED.deviceId, state: "outdated" });
    expect(cloud.checks).toBe(1);
    expect(runtime.session.current()).toMatchObject({ credential: CRED, kind: "outdated" });
  });

  it("stays signed in when the cloud cannot be reached, and says why to the sink", async () => {
    const cloud = createFakeCloud();
    cloud.checkResults.push(UNREACHABLE);
    const debugged: string[] = [];
    const runtime = runtimeOver(cloud, {
      onDebug: (message) => {
        debugged.push(message);
      },
    });
    runtime.setCredential(CRED);
    runtime.start();
    await nextTask();

    expect(runtime.get()).toStrictEqual({ deviceId: CRED.deviceId, state: "signed-in" });
    expect(debugged).toEqual([expect.stringContaining("offline")]);
  });

  it("lands a revocation on the timer's check, with no pull-to-refresh", async () => {
    const cloud = createFakeCloud();
    cloud.checkResults.push({ ok: true, value: { devices: [] } }, UNAUTHORIZED);
    const runtime = runtimeOver(cloud, { pollIntervalMs: 5 });
    runtime.setCredential(CRED);
    runtime.start();

    const revoked = await published(runtime, (status) => status.state === "unauthorized");
    expect(revoked).toMatchObject({ deviceId: CRED.deviceId, state: "unauthorized" });
    expect(cloud.checks).toBe(2);
  });

  it("publishes the same snapshot until something moves", () => {
    const runtime = runtimeOver(createFakeCloud());
    runtime.setCredential(CRED);
    const first = runtime.get();
    // identity, not equality: a snapshot rebuilt per read loops useSyncExternalStore
    expect(runtime.get()).toBe(first);
  });
});

// a runtime whose socket dials a recording fake: every dial's args and every close
const socketed = () => {
  const cloud = createFakeCloud();
  const dials: OpenCloudSocketArgs[] = [];
  const pings = { vault: 0 };
  let closes = 0;
  const runtime = createSyncRuntime({
    build: TEST_BUILD,
    cloudUrl: "https://cloud.test",
    createClient: () => cloud.client,
    onVaultPing: () => {
      pings.vault += 1;
    },
    openSocket: (args) => {
      dials.push(args);
      return {
        close: () => {
          closes += 1;
        },
      };
    },
    pollIntervalMs: null,
  });
  const lastDial = (): OpenCloudSocketArgs => {
    const dial = dials.at(-1);
    if (dial === undefined) {
      throw new Error("expected a socket dial");
    }
    return dial;
  };
  return { closes: () => closes, cloud, dials, lastDial, pings, runtime };
};

describe("the account's socket", () => {
  it("never dials while signed out, or before a credential is handed over", () => {
    const { dials, runtime } = socketed();
    runtime.start();
    runtime.resume();
    runtime.setCredential(null);
    runtime.start();
    runtime.resume();

    expect(dials).toEqual([]);
  });

  it("dials once signed in and started", () => {
    const { dials, runtime } = socketed();
    runtime.setCredential(CRED);
    expect(dials).toEqual([]);

    runtime.start();

    expect(dials).toHaveLength(1);
  });

  it("hands a vault ping to the notes, and checks nothing for it", async () => {
    const { cloud, lastDial, pings, runtime } = socketed();
    runtime.setCredential(CRED);
    runtime.start();
    await nextTask();
    const settled = cloud.checks;

    lastDial().onPing({ type: "vault" });
    await nextTask();

    expect(pings).toEqual({ vault: 1 });
    expect(cloud.checks).toBe(settled);
  });

  it("checks the sign-in when it opens: a revocation while it was down is heard then", async () => {
    const { cloud, lastDial, runtime } = socketed();
    runtime.setCredential(CRED);
    runtime.start();
    await nextTask();
    const settled = cloud.checks;

    lastDial().onOpen();
    await nextTask();

    expect(cloud.checks).toBe(settled + 1);
  });

  it("closes in the background, and a resume dials again and checks", async () => {
    const { closes, cloud, dials, runtime } = socketed();
    runtime.setCredential(CRED);
    runtime.start();
    await nextTask();

    runtime.suspend();
    expect(closes()).toBe(1);
    runtime.start();
    expect(dials).toHaveLength(1);
    const suspended = cloud.checks;

    runtime.resume();
    await nextTask();

    expect(dials).toHaveLength(2);
    expect(cloud.checks).toBeGreaterThan(suspended);
  });

  it("closes for good on a sign-out: the old socket's close dials nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { closes, dials, lastDial, runtime } = socketed();
    runtime.setCredential(CRED);
    runtime.start();
    await nextTask();
    const dial = lastDial();

    runtime.setCredential(null);
    dial.onClose(1000);
    vi.advanceTimersByTime(120_000);

    expect(closes()).toBe(1);
    expect(dials).toHaveLength(1);
  });

  it("asks over http when the cloud severs it, and dials no more once that is refused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { cloud, dials, lastDial, runtime } = socketed();
    runtime.setCredential(CRED);
    runtime.start();
    await nextTask();
    cloud.checkResults.push(UNAUTHORIZED);

    lastDial().onClose(SYNC_WS_REVOKED_CLOSE_CODE);
    await nextTask();
    vi.advanceTimersByTime(120_000);

    expect(runtime.get().state).toBe("unauthorized");
    expect(dials).toHaveLength(1);
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
    build: TEST_BUILD,
    cloudUrl: "https://cloud.test",
    createClient,
    pollIntervalMs: null,
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
      build: TEST_BUILD,
      cloudUrl: "https://cloud.test",
      createClient: () => ({ ...cloud.client, signOut: async () => await UNREACHABLE_SIGN_OUT }),
      pollIntervalMs: null,
    });
    runtime.setCredential(CRED);
    runtime.setCredential(null);
    expect(runtime.get()).toStrictEqual({ state: "signed-out" });
  });

  it("asks nothing of the cloud for a credential it already refused", async () => {
    const { cloud, runtime, signedOut } = recordingSignOuts();
    cloud.checkResults.push(UNAUTHORIZED);
    runtime.setCredential(CRED);
    runtime.start();
    await published(runtime, (status) => status.state === "unauthorized");

    runtime.setCredential(null);
    expect(signedOut).toEqual([]);
  });
});
