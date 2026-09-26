import type { CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import type { CloudResult } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import type { PullResponse } from "@repo/api/cloud/sync/sync-schema";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { clientOver, createFakeVault } from "../../notes/__tests__/fake-vault";
import {
  createMemoryAttachments,
  createMemoryOutboxFiles,
  nodeSha1,
  openTempDb,
  tempDbPath,
} from "../../notes/__tests__/phone-storage";
import { agentMessage, createFakeCloud, logRow, ok } from "../../sync/__tests__/fakes";
import type { FakeCloud } from "../../sync/__tests__/fakes";
import { composeRuntime } from "../compose-runtime";
import type { CredentialStore } from "../compose-runtime";
import type { ReadableStore } from "../external-store";
import type { SqlDriver } from "../sql-driver";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };
const OTHER_CRED = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_other" };

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

interface PhoneStorage {
  db: SqlDriver;
  attachments: ReturnType<typeof createMemoryAttachments>;
  outboxFiles: ReturnType<typeof createMemoryOutboxFiles>;
}

const phoneStorage = (db: SqlDriver = openTempDb()): PhoneStorage => ({
  attachments: createMemoryAttachments(),
  db,
  outboxFiles: createMemoryOutboxFiles(),
});

// a cloud whose hosted vault holds one note and one image
const vaultCloud = (): FakeCloud => {
  const vault = clientOver(
    createFakeVault({ "media/photo.png": "png bytes", "note.md": "# note\n" }).fetch,
  );
  return createFakeCloud({
    vaultAsset: vault.vaultAsset,
    vaultAssetSource: vault.vaultAssetSource,
    vaultFile: vault.vaultFile,
    vaultFiles: vault.vaultFiles,
    vaultTree: vault.vaultTree,
  });
};

const heldRows = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(content) AS held FROM mirror_entries");
  return z.object({ held: z.number() }).parse(row).held;
};

const queuedRows = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(*) AS queued FROM outbox");
  return z.object({ queued: z.number() }).parse(row).queued;
};

const runtimeOver = (
  cloud: FakeCloud,
  credentials: CredentialStore,
  storage: PhoneStorage = phoneStorage(),
) => {
  let minted = 0;
  return composeRuntime({
    attachments: storage.attachments,
    cloudUrl: "https://cloud.test",
    credentials,
    db: storage.db,
    deviceName: "Test Phone",
    mintCaptureKey: () => {
      minted += 1;
      return `key-${minted}`;
    },
    outboxFiles: storage.outboxFiles,
    retryBaseMs: null,
    sha1: nodeSha1,
    sync: { createClient: () => cloud.client, pollIntervalMs: null },
  });
};

type Runtime = ReturnType<typeof runtimeOver>;

// signed in and mirrored, with the image downloaded, so a wipe has something of each to take
const mirrorOnce = async (rt: Runtime): Promise<void> => {
  await rt.start();
  await until(rt.notes.tree, (tree) => tree.state === "ready" && tree.progress === null);
  await rt.notes.refresh();
  expect(await rt.notes.attachmentFile("media/photo.png")).toMatchObject({ ok: true });
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

  it("idles the notes and wipes the mirror when a pull hears unauthorized, keeping the credential", async () => {
    const cloud = vaultCloud();
    const credentials = keychain(CRED);
    const storage = phoneStorage();
    const rt = runtimeOver(cloud, credentials.store, storage);
    await mirrorOnce(rt);
    await until(rt.sync, (status) => status.state === "signed-in" && status.lastSyncedAt !== null);

    cloud.pullResults.push(UNAUTHORIZED);
    await rt.sync.syncNow();

    expect(rt.sync.get().state).toBe("unauthorized");
    expect(rt.notes.tree.get()).toStrictEqual({ state: "idle" });
    await vi.waitFor(async () => {
      expect(await heldRows(storage.db)).toBe(0);
      expect(storage.attachments.names()).toEqual([]);
    });
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

describe("the phone's note mirror across sign-ins", () => {
  it("keeps what it holds across a relaunch, and serves it before any request", async () => {
    const file = tempDbPath();
    const first = phoneStorage(openTempDb(file));
    await mirrorOnce(runtimeOver(vaultCloud(), keychain(CRED).store, first));

    const offline = createFakeCloud({
      vaultTree: async () => ({ failure: { kind: "unreachable", message: "offline" }, ok: false }),
    });
    const relaunched = runtimeOver(offline, keychain(CRED).store, {
      ...first,
      db: openTempDb(file),
    });
    await relaunched.start();
    await until(relaunched.notes.tree, (tree) => tree.state === "ready");

    expect(await relaunched.notes.readNote("note.md")).toMatchObject({ content: "# note\n" });
    expect(await heldRows(first.db)).toBe(1);
    expect(first.attachments.names()).toHaveLength(1);
  });

  it("wipes the mirror and the attachments on signing out", async () => {
    const storage = phoneStorage();
    const rt = runtimeOver(vaultCloud(), keychain(CRED).store, storage);
    await mirrorOnce(rt);

    await rt.logout();

    await vi.waitFor(async () => {
      expect(await heldRows(storage.db)).toBe(0);
      expect(storage.attachments.names()).toEqual([]);
    });
  });

  it("wipes the mirror and the attachments on signing in", async () => {
    const storage = phoneStorage();
    const cloud = vaultCloud();
    const rt = runtimeOver(cloud, keychain(CRED).store, storage);
    await mirrorOnce(rt);
    // the new sign-in's own mirror would refill the rows; this one cannot reach its vault
    cloud.client.vaultTree = async () => ({
      failure: { kind: "unreachable", message: "offline" },
      ok: false,
    });
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

    expect(rt.login.get()).toStrictEqual({ kind: "idle" });
    expect(rt.sync.get()).toMatchObject({ deviceId: OTHER_CRED.deviceId });
    await vi.waitFor(async () => {
      expect(await heldRows(storage.db)).toBe(0);
      expect(storage.attachments.names()).toEqual([]);
    });
  });
});

describe("signing out with edits the vault has not taken", () => {
  it("refuses without a discard, and a discard wipes the queue and the staged files", async () => {
    const storage = phoneStorage();
    // the vault's write route never answers, so every edit stays on the phone
    const rt = runtimeOver(vaultCloud(), keychain(CRED).store, storage);
    await mirrorOnce(rt);
    expect(await rt.notes.readNote("note.md")).toMatchObject({ ok: true });
    await rt.notes.write("note.md", "# note\n\nwritten offline\n");
    await rt.notes.putAsset("media/new.png", new Uint8Array([1, 2, 3]));

    expect(await rt.logout()).toStrictEqual({ count: 2, kind: "unsent" });
    expect(rt.sync.get()).toMatchObject({ state: "signed-in" });
    expect(await queuedRows(storage.db)).toBe(2);
    expect(storage.outboxFiles.names()).toHaveLength(1);

    expect(await rt.logout({ discardUnsent: true })).toStrictEqual({ kind: "signed-out" });
    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    await vi.waitFor(async () => {
      expect(await queuedRows(storage.db)).toBe(0);
      expect(storage.outboxFiles.names()).toEqual([]);
    });
  });

  it("signs straight out when nothing is unsent", async () => {
    const rt = runtimeOver(vaultCloud(), keychain(CRED).store);
    await mirrorOnce(rt);
    expect(await rt.logout()).toStrictEqual({ kind: "signed-out" });
  });
});
