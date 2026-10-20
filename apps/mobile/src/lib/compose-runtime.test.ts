import type { CloudResult } from "@repo/contract/cloud/client";
import type {
  DeviceCredential,
  ListDevicesResponse,
} from "@repo/contract/cloud/device/device-schema";
import type {
  CloudSocketOpener,
  OpenCloudSocketArgs,
} from "@repo/contract/cloud/sync/cloud-socket";
import { TEST_BUILD } from "@repo/contract/cloud/test-support/fake-cloud-client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { clientOver, createFakeVault } from "../notes/test-support/fake-vault";
import {
  createMemoryAttachments,
  createMemoryOutboxFiles,
  MINTED_NOTE_ID,
  nodeSha1,
  openTempDb,
  tempDbPath,
} from "../notes/test-support/phone-storage";
import { createFakeCloud, ok } from "../sync/test-support/fake-cloud";
import type { FakeCloud } from "../sync/test-support/fake-cloud";
import { composeRuntime } from "./compose-runtime";
import type { CredentialStore } from "./compose-runtime";
import type { SqlDriver } from "./sql-driver";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };
const OTHER_CRED = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_other" };
// what the cloud answers a sign-in with: the credential, and the account it names
const OTHER_LOGIN = { ...OTHER_CRED, email: "me@example.test", userId: "user_other" };

const UNAUTHORIZED: CloudResult<ListDevicesResponse> = {
  failure: { code: "unauthorized", kind: "refused", message: "unauthorized" },
  ok: false,
};

const OUTDATED: CloudResult<ListDevicesResponse> = {
  failure: { code: "client-outdated", kind: "refused", message: "update" },
  ok: false,
};

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

const waitingFills = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(*) AS waiting FROM pending_fills");
  return z.object({ waiting: z.number() }).parse(row).waiting;
};

const runtimeOver = (
  cloud: FakeCloud,
  credentials: CredentialStore,
  storage: PhoneStorage = phoneStorage(),
  openSocket?: CloudSocketOpener,
) =>
  composeRuntime({
    attachments: storage.attachments,
    build: TEST_BUILD,
    cloudUrl: "https://cloud.test",
    credentials,
    db: storage.db,
    deviceName: "Test Phone",
    // offline: these tests hold no link fill
    fill: {
      fetch: async () =>
        await Promise.resolve({
          failure: { kind: "unreachable", transient: true } as const,
          ok: false as const,
        }),
      online: () => false,
      read: async () => await Promise.reject(new Error("no reader in this suite")),
      sha256Hex: async () => await Promise.resolve("0".repeat(64)),
      shrinkCover: async () => await Promise.resolve(null),
    },
    newId: () => MINTED_NOTE_ID,
    outboxFiles: storage.outboxFiles,
    randomBytes: (length) => new Uint8Array(length),
    retryBaseMs: null,
    sha1: nodeSha1,
    sync:
      openSocket === undefined
        ? { createClient: () => cloud.client, pollIntervalMs: null }
        : { createClient: () => cloud.client, openSocket, pollIntervalMs: null },
  });

type Runtime = ReturnType<typeof runtimeOver>;

// signed in and mirrored, with the image downloaded, so a wipe has something of each to take
const mirrorOnce = async (rt: Runtime): Promise<void> => {
  await rt.start();
  await vi.waitFor(() => {
    expect(rt.notes.tree.get()).toMatchObject({ progress: null, state: "ready" });
  });
  await rt.notes.refresh();
  expect(await rt.notes.attachmentFile("media/photo.png")).toMatchObject({ ok: true });
};

describe("the composed runtime", () => {
  it("is restoring until the stored credential is read, then signed in with its tree", async () => {
    const rt = runtimeOver(createFakeCloud(), keychain(CRED).store);
    expect(rt.sync.get()).toStrictEqual({ state: "restoring" });

    await rt.start();

    expect(rt.sync.get()).toMatchObject({ deviceId: CRED.deviceId, state: "signed-in" });
    await vi.waitFor(() => {
      expect(rt.notes.tree.get()).toMatchObject({ state: "ready" });
    });
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

  it("idles the notes and wipes the mirror when a check hears unauthorized, keeping the credential", async () => {
    const cloud = vaultCloud();
    const credentials = keychain(CRED);
    const storage = phoneStorage();
    const rt = runtimeOver(cloud, credentials.store, storage);
    await mirrorOnce(rt);

    cloud.checkResults.push(UNAUTHORIZED);
    rt.resume();

    await vi.waitFor(() => {
      expect(rt.sync.get().state).toBe("unauthorized");
    });
    expect(rt.notes.tree.get()).toStrictEqual({ state: "idle" });
    await vi.waitFor(async () => {
      expect(await heldRows(storage.db)).toBe(0);
      expect(storage.attachments.names()).toEqual([]);
    });
    expect(credentials.calls).not.toContain("clear");
  });

  it("keeps the mirror and the credential when the cloud refuses this build", async () => {
    const cloud = vaultCloud();
    const credentials = keychain(CRED);
    const storage = phoneStorage();
    const rt = runtimeOver(cloud, credentials.store, storage);
    await mirrorOnce(rt);
    const held = await heldRows(storage.db);

    cloud.checkResults.push(OUTDATED);
    rt.resume();

    await vi.waitFor(() => {
      expect(rt.sync.get()).toStrictEqual({ deviceId: CRED.deviceId, state: "outdated" });
    });
    expect(await heldRows(storage.db)).toBe(held);
    expect(held).toBeGreaterThan(0);
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
    await vi.waitFor(() => {
      expect(rt.notes.tree.get()).toMatchObject({ state: "ready" });
    });

    await rt.logout();

    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    expect(rt.notes.tree.get()).toStrictEqual({ state: "idle" });
    expect(rt.login.get()).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("keychain locked"),
    });
  });

  it("checks the sign-in on resume — the foreground is when a revocation is heard", async () => {
    const cloud = createFakeCloud();
    const rt = runtimeOver(cloud, keychain(CRED).store);
    await rt.start();
    await vi.waitFor(() => {
      expect(cloud.checks).toBe(1);
    });

    rt.resume();

    await vi.waitFor(() => {
      expect(cloud.checks).toBe(2);
    });
  });

  it("hears another device's push over the socket, and closes it in the background", async () => {
    let trees = 0;
    const cloud = createFakeCloud({
      vaultTree: async () => {
        trees += 1;
        return ok({ commit: "0".repeat(40), entries: [], next: null });
      },
    });
    const dials: OpenCloudSocketArgs[] = [];
    let closes = 0;
    const rt = runtimeOver(cloud, keychain(CRED).store, phoneStorage(), (args) => {
      dials.push(args);
      return {
        close: () => {
          closes += 1;
        },
      };
    });
    await rt.start();
    // a ping during the sign-in's own refresh joins it rather than listing again
    await rt.notes.refresh();
    const [dial] = dials;
    if (dial === undefined) {
      throw new Error("expected the signed-in phone to dial its socket");
    }
    const listed = trees;

    dial.onPing({ type: "vault" });
    await vi.waitFor(() => {
      expect(trees).toBeGreaterThan(listed);
    });

    rt.suspend();
    expect(closes).toBe(1);
    rt.resume();
    expect(dials).toHaveLength(2);
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
    await vi.waitFor(() => {
      expect(relaunched.notes.tree.get()).toMatchObject({ state: "ready" });
    });

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

  it("wipes the mirror and the attachments on signing in, and keeps the bearer alone", async () => {
    const storage = phoneStorage();
    const cloud = vaultCloud();
    const credentials = keychain(CRED).store;
    const rt = runtimeOver(cloud, credentials, storage);
    await mirrorOnce(rt);
    // the new sign-in's own mirror would refill the rows; this one cannot reach its vault
    cloud.client.vaultTree = async () => ({
      failure: { kind: "unreachable", message: "offline" },
      ok: false,
    });
    vi.stubGlobal("fetch", async () => Response.json(OTHER_LOGIN));
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
    expect(await credentials.read()).toStrictEqual(OTHER_CRED);
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
    await rt.notes.write("note.md", "# note\n\nwritten offline\n", {
      base: "# note\n",
      kind: "expected",
    });
    await rt.notes.putAsset("media/new.png", new Uint8Array([1, 2, 3]));
    // offline here, so the link's fill waits with it
    await rt.items.saveLink({ note: null, title: "Later", url: "https://example.com/later" });

    expect(await rt.logout()).toStrictEqual({ edits: 3, kind: "unsent" });
    expect(rt.sync.get()).toMatchObject({ state: "signed-in" });
    expect(await queuedRows(storage.db)).toBe(3);
    expect(await waitingFills(storage.db)).toBe(1);
    expect(storage.outboxFiles.names()).toHaveLength(1);

    expect(await rt.logout({ discardUnsent: true })).toStrictEqual({ kind: "signed-out" });
    expect(rt.sync.get()).toStrictEqual({ state: "signed-out" });
    await vi.waitFor(async () => {
      expect(await queuedRows(storage.db)).toBe(0);
      expect(await waitingFills(storage.db)).toBe(0);
      expect(storage.outboxFiles.names()).toEqual([]);
    });
  });

  it("signs straight out when nothing is unsent", async () => {
    const rt = runtimeOver(vaultCloud(), keychain(CRED).store);
    await mirrorOnce(rt);
    expect(await rt.logout()).toStrictEqual({ kind: "signed-out" });
  });
});
