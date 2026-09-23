import type { CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import type { CloudResult } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import type { PullResponse } from "@repo/api/cloud/sync/sync-schema";
import { describe, expect, it } from "vitest";
import { createMemoryNoteCache } from "../../notes/note-cache";
import type { NoteCache } from "../../notes/note-cache";
import { agentMessage, createFakeCloud, logRow, ok } from "../../sync/__tests__/fakes";
import type { FakeCloud } from "../../sync/__tests__/fakes";
import { composeRuntime } from "../compose-runtime";
import type { CredentialStore } from "../compose-runtime";
import type { ReadableStore } from "../external-store";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };

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

const recordingCache = () => {
  const inner = createMemoryNoteCache(100);
  const calls: string[] = [];
  const cache: NoteCache = {
    ...inner,
    clear: async () => {
      calls.push("clear");
      await inner.clear();
    },
  };
  return { cache, calls };
};

const runtimeOver = (
  cloud: FakeCloud,
  credentials: CredentialStore,
  cache: NoteCache = createMemoryNoteCache(100),
) => {
  let minted = 0;
  return composeRuntime({
    cache,
    cloudUrl: "https://cloud.test",
    credentials,
    mintCaptureKey: () => {
      minted += 1;
      return `key-${minted}`;
    },
    sync: { createClient: () => cloud.client, pollIntervalMs: null },
  });
};

describe("the composed runtime", () => {
  it("is restoring until the stored credential is read, then signed in with its tree", async () => {
    const rt = runtimeOver(createFakeCloud(), keychain(CRED).store);
    expect(rt.sync.get()).toStrictEqual({ state: "restoring" });

    await rt.start();

    expect(rt.sync.get()).toMatchObject({ deviceId: CRED.deviceId, state: "signed-in" });
    await until(rt.notes.tree, (tree) => tree.state === "ready");
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

  it("idles the notes and wipes their cache when a pull hears unauthorized, keeping the credential", async () => {
    const cloud = createFakeCloud();
    const credentials = keychain(CRED);
    const { cache, calls } = recordingCache();
    const rt = runtimeOver(cloud, credentials.store, cache);
    await rt.start();
    await until(rt.notes.tree, (tree) => tree.state === "ready");
    await until(rt.sync, (status) => status.state === "signed-in" && status.lastSyncedAt !== null);
    expect(calls).toEqual([]);

    cloud.pullResults.push(UNAUTHORIZED);
    await rt.sync.syncNow();

    expect(rt.sync.get().state).toBe("unauthorized");
    expect(rt.notes.tree.get()).toStrictEqual({ state: "idle" });
    expect(calls).toEqual(["clear"]);
    expect(credentials.calls).not.toContain("clear");
  });

  it("signs both runtimes out when the Keychain refuses the delete, and says so", async () => {
    const credentials = keychain(CRED, {
      clear: async () => {
        throw new Error("keychain locked");
      },
    });
    const rt = runtimeOver(createFakeCloud(), credentials.store);
    await rt.start();
    await until(rt.notes.tree, (tree) => tree.state === "ready");

    await rt.logout();

    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    expect(rt.notes.tree.get()).toStrictEqual({ state: "idle" });
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

  it("sends a capture's retry under the key its first try carried", async () => {
    const cloud = createFakeCloud();
    const lost: CloudResult<CaptureResponse> = {
      failure: { kind: "unreachable", message: "offline" },
      ok: false,
    };
    cloud.captureResults.push(lost);
    const rt = runtimeOver(cloud, keychain(CRED).store);
    await rt.start();

    const first = await rt.submitCapture("buy milk");
    const retried = await rt.submitCapture("buy milk");
    expect([first.ok, retried.ok]).toEqual([false, true]);

    expect(cloud.captures.map((request) => request.idempotencyKey)).toEqual(["key-1", "key-1"]);
  });
});
