import type { CloudResult } from "@repo/contract/cloud/client";
import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import type {
  CloudSocketOpener,
  OpenCloudSocketArgs,
} from "@repo/contract/cloud/sync/cloud-socket";
import type { PullResponse } from "@repo/contract/cloud/sync/sync-schema";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentMessage, createFakeCloud, logRow, ok } from "../../sync/__tests__/fakes";
import type { FakeCloud } from "../../sync/__tests__/fakes";
import { composeRuntime } from "../compose-runtime";
import type { CredentialStore } from "../compose-runtime";
import type { ReadableStore } from "../external-store";
import type { SqlDriver } from "../sql-driver";
import { nodeSha1, openTempDb, tempDbPath } from "./phone-storage";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };
const OTHER_CRED = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_other" };

// the shape the dispatch contract holds an id to: 32 lowercase hex characters
const mintedId = (n: number): string => n.toString(16).padStart(32, "0");

const UNAUTHORIZED: CloudResult<PullResponse> = {
  failure: { code: "unauthorized", deviceSeq: null, kind: "refused", message: "unauthorized" },
  ok: false,
};

const until = async <T>(store: ReadableStore<T>, done: (value: T) => boolean): Promise<T> =>
  // oxlint-disable-next-line promise/avoid-new -- the value arrives as a store notification, which only a promise can hand to an await
  await new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const check = (): void => {
      const value = store.get();
      if (!done(value)) {
        return;
      }
      unsubscribe?.();
      resolve(value);
    };
    unsubscribe = store.subscribe(check);
    check();
  });

const keychain = (stored: DeviceCredential | null, overrides: Partial<CredentialStore> = {}) => {
  const calls: string[] = [];
  let value = stored;
  const store: CredentialStore = {
    clear: async () => {
      calls.push("clear");
      value = null;
    },
    read: async () => value,
    write: async (credential) => {
      calls.push("write");
      value = credential;
    },
    ...overrides,
  };
  return { calls, store };
};

const threadRows = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(*) AS held FROM thread_events");
  return z.object({ held: z.number() }).parse(row).held;
};

const dispatchRows = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(*) AS queued FROM dispatch_outbox");
  return z.object({ queued: z.number() }).parse(row).queued;
};

const runtimeOver = (
  cloud: FakeCloud,
  credentials: CredentialStore,
  db: SqlDriver = openTempDb(),
  openSocket?: CloudSocketOpener,
) => {
  let minted = 0;
  return composeRuntime({
    cloudUrl: "https://cloud.test",
    credentials,
    db,
    dispatchPollIntervalMs: null,
    mintId: () => {
      minted += 1;
      return mintedId(minted);
    },
    sha1: nodeSha1,
    sync:
      openSocket === undefined
        ? { createClient: () => cloud.client, pollIntervalMs: null }
        : { createClient: () => cloud.client, openSocket, pollIntervalMs: null },
  });
};

type Runtime = ReturnType<typeof runtimeOver>;

// a cloud whose log holds one answer from the Mac
const threadCloud = (): FakeCloud => {
  const cloud = createFakeCloud();
  cloud.pullResults.push(
    ok({
      events: [
        logRow({
          deviceId: "dev_other",
          deviceSeq: 0,
          event: agentMessage("thr_x", "t1", "m1", "from the Mac"),
          seq: 1,
        }),
      ],
      hasMore: false,
      lastSeq: 1,
    }),
  );
  return cloud;
};

// signed in and pulled once, so a wipe has a thread to take
const pulledOnce = async (rt: Runtime): Promise<void> => {
  await rt.start();
  await until(rt.sync, (status) => status.state === "signed-in" && status.cursor === 1);
  expect(rt.store.snapshotThread("thr_x")?.events).toHaveLength(1);
};

describe("the composed runtime", () => {
  it("is restoring until the stored credential is read, then signed in", async () => {
    const rt = runtimeOver(createFakeCloud(), keychain(CRED).store);
    expect(rt.sync.get()).toStrictEqual({ state: "restoring" });

    await rt.start();

    expect(rt.sync.get()).toMatchObject({ deviceId: CRED.deviceId, state: "signed-in" });
  });

  it("ends restoring as signed out when nothing is stored", async () => {
    const rt = runtimeOver(createFakeCloud(), keychain(null).store);
    await rt.start();
    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    expect(rt.login.get()).toStrictEqual({ kind: "idle" });
  });

  it("ends restoring as signed out when the Keychain refuses the read, and says why", async () => {
    const credentials = keychain(CRED, {
      read: async () => {
        throw new Error("keychain locked");
      },
    });
    const rt = runtimeOver(createFakeCloud(), credentials.store);
    await rt.start();
    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    expect(rt.login.get()).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("keychain locked"),
    });
  });

  it("signs both runtimes out when the Keychain refuses the delete, and says so", async () => {
    const credentials = keychain(CRED, {
      clear: async () => {
        throw new Error("keychain locked");
      },
    });
    const rt = runtimeOver(createFakeCloud(), credentials.store);
    await rt.start();

    await rt.logout();

    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    expect(rt.login.get()).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("keychain locked"),
    });
  });

  it("pulls on resume — the foreground is a sync trigger", async () => {
    const cloud = createFakeCloud();
    const rt = runtimeOver(cloud, keychain(CRED).store);
    await rt.start();
    await until(rt.sync, (status) => status.state === "signed-in" && status.lastSyncedAt !== null);

    cloud.pullResults.push(
      ok({
        events: [
          logRow({
            deviceId: "dev_other",
            deviceSeq: 0,
            event: agentMessage("thr_x", "t1", "m1", "while backgrounded"),
            seq: 1,
          }),
        ],
        hasMore: false,
        lastSeq: 1,
      }),
    );
    rt.resume();

    await until(rt.sync, (status) => status.state === "signed-in" && status.cursor === 1);
    expect(rt.store.snapshotThread("thr_x")?.events).toHaveLength(1);
  });

  it("hears another device's push over the socket, and closes it in the background", async () => {
    const cloud = createFakeCloud();
    const dials: OpenCloudSocketArgs[] = [];
    let closes = 0;
    const rt = runtimeOver(cloud, keychain(CRED).store, openTempDb(), (args) => {
      dials.push(args);
      return {
        close: () => {
          closes += 1;
        },
      };
    });
    await rt.start();
    await until(rt.sync, (status) => status.state === "signed-in" && status.lastSyncedAt !== null);
    const [dial] = dials;
    if (dial === undefined) {
      throw new Error("expected the signed-in phone to dial its socket");
    }

    cloud.pullResults.push(
      ok({
        events: [
          logRow({
            deviceId: "dev_other",
            deviceSeq: 0,
            event: agentMessage("thr_x", "t1", "m1", "pushed while the phone watched"),
            seq: 1,
          }),
        ],
        hasMore: false,
        lastSeq: 1,
      }),
    );
    dial.onPing({ seq: 1, type: "sync" });
    await until(rt.sync, (status) => status.state === "signed-in" && status.cursor === 1);

    rt.suspend();
    expect(closes).toBe(1);
    rt.resume();
    expect(dials).toHaveLength(2);
  });
});

describe("the phone's threads across sign-ins", () => {
  it("keeps them across a relaunch, listed before any request lands", async () => {
    const file = tempDbPath();
    await pulledOnce(runtimeOver(threadCloud(), keychain(CRED).store, openTempDb(file)));

    const offline = createFakeCloud({
      pull: async () => ({ failure: { kind: "unreachable", message: "offline" }, ok: false }),
    });
    const relaunched = runtimeOver(offline, keychain(CRED).store, openTempDb(file));
    await relaunched.start();

    expect(relaunched.store.snapshotThread("thr_x")?.events).toHaveLength(1);
    expect(relaunched.sync.get()).toMatchObject({ cursor: 1, state: "signed-in" });
  });

  it("wipes them on signing out", async () => {
    const db = openTempDb();
    const rt = runtimeOver(threadCloud(), keychain(CRED).store, db);
    await pulledOnce(rt);

    await rt.logout();

    expect(rt.store.snapshotThreads()).toStrictEqual([]);
    expect(await threadRows(db)).toBe(0);
  });

  it("wipes them on signing in, and the new sign-in starts at the log's first row", async () => {
    const db = openTempDb();
    const rt = runtimeOver(threadCloud(), keychain(CRED).store, db);
    await pulledOnce(rt);
    vi.stubGlobal("fetch", async () => Response.json(OTHER_CRED));
    try {
      await rt.login.login({
        deviceName: "phone",
        email: "me@example.test",
        password: "a".repeat(12),
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(rt.sync.get()).toMatchObject({ cursor: 0, deviceId: OTHER_CRED.deviceId });
    expect(rt.store.snapshotThreads()).toStrictEqual([]);
    expect(await threadRows(db)).toBe(0);
  });

  it("wipes them when a pull hears the device was signed out, keeping the credential", async () => {
    const db = openTempDb();
    const cloud = threadCloud();
    const credentials = keychain(CRED);
    const rt = runtimeOver(cloud, credentials.store, db);
    await pulledOnce(rt);

    cloud.pullResults.push(UNAUTHORIZED);
    await rt.sync.syncNow();

    expect(rt.sync.get().state).toBe("unauthorized");
    expect(rt.store.snapshotThreads()).toStrictEqual([]);
    await vi.waitFor(async () => {
      expect(await threadRows(db)).toBe(0);
    });
    expect(credentials.calls).not.toContain("clear");
  });
});

describe("signing out with requests no Mac has had yet", () => {
  it("counts the requests no Mac has had yet, and a discard wipes them", async () => {
    const db = openTempDb();
    const rt = runtimeOver(createFakeCloud(), keychain(CRED).store, db);
    await rt.start();
    expect(
      await rt.dispatch.askAgent({ text: "asked offline", threadId: rt.dispatch.newThreadId() }),
    ).toMatchObject({ ok: true });
    expect(await dispatchRows(db)).toBe(1);

    expect(await rt.logout()).toStrictEqual({ kind: "unsent", requests: 1 });
    expect(rt.sync.get()).toMatchObject({ state: "signed-in" });
    expect(await dispatchRows(db)).toBe(1);

    expect(await rt.logout({ discardUnsent: true })).toStrictEqual({ kind: "signed-out" });
    expect(rt.dispatch.get().dispatches).toStrictEqual([]);
    await vi.waitFor(async () => {
      expect(await dispatchRows(db)).toBe(0);
    });
  });

  it("signs straight out when nothing is unsent", async () => {
    const rt = runtimeOver(createFakeCloud(), keychain(CRED).store);
    await rt.start();
    expect(await rt.logout()).toStrictEqual({ kind: "signed-out" });
  });
});
