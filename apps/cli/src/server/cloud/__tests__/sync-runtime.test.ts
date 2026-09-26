import { ACCOUNT_API_PATHS } from "@repo/api/cloud/account/account-schema";
import { CAPTURE_API_PATHS } from "@repo/api/cloud/captures/captures-schema";
import { DEVICE_API_PATHS } from "@repo/api/cloud/device/device-schema";
import { CLOUD_ERROR_STATUS, cloudError } from "@repo/api/cloud/errors";
import { SYNC_API_PATHS } from "@repo/api/cloud/sync/sync-schema";
import { MAX_PULL_PAGES_PER_PASS } from "@repo/api/cloud/sync/sync-session";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "@repo/api/cloud/sync/sync-ws";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { closeConnection, createConnection, writeTransaction } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { MissingTurnStartedError } from "@repo/db/events";
import { runMigrations } from "@repo/db/migrate";
import { countSyncOutbox, readSyncState, writeSyncCursor } from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { CAPTURE_INBOX_PATH } from "@repo/notes/sync/reconcile-file";
import nodePath from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import type { CaptureVault } from "../captures";
import type { CloudFetch, CloudSocket, OpenCloudSocketArgs } from "@repo/api/cloud/client";
import { readDeviceCredential, writeDeviceCredential } from "../credential-store";
import type { DeviceCredential } from "../credential-store";
import type { SyncedEventSink } from "../sync-pass";
import { createCloudRuntime } from "../sync-runtime";
import type { CloudRuntime, CloudTransport, LoginOutcome } from "../sync-runtime";
import { VaultServiceError } from "../../vault/vault-service";
import { makeTempDir } from "../../__tests__/temp-dir";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

const CLOUD_URL = "https://cloud.test";

const SIGNED_OUT: CloudStatusResponse = {
  cloudUrl: CLOUD_URL,
  revokeError: null,
  state: "signed-out",
};

afterEach(() => {
  vi.useRealTimers();
});

interface FakeVault extends CaptureVault {
  files: Map<string, string>;
}

const makeVault = (): FakeVault => {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new VaultServiceError("not_found", `No such vault entry: ${path}`);
      }
      return await Promise.resolve({ content, path });
    },
    writeGuarded: async (path, content, guard) => {
      if (guard.kind === "absent") {
        if (files.has(path)) {
          return await Promise.resolve({ applied: false, reason: "exists" });
        }
        files.set(path, content);
        return await Promise.resolve({ applied: true, path });
      }
      files.set(path, content);
      return await Promise.resolve({ applied: true, path });
    },
    writeIfUnchanged: async (path, expected, content) => {
      if (files.get(path) !== expected) {
        return await Promise.resolve({ applied: false, reason: "changed" });
      }
      files.set(path, content);
      return await Promise.resolve({ applied: true, path });
    },
  };
};

interface Harness {
  db: DbConnection;
  dataDir: string;
  cloud: FakeCloud;
  vault: FakeVault;
  runtime: CloudRuntime;
  applied: { threadId: string; events: readonly ThreadEvent[]; cursor: number }[];
  socketOpens: OpenCloudSocketArgs[];
  vaultPings: () => number;
  /** the status as each onStatusChanged found it. */
  statusNotices: CloudStatusResponse[];
  /** every line of the sync trace, which every harness runs with on. */
  traced: string[];
}

const makeHarness = (
  options: {
    fetch?: CloudFetch;
    pollIntervalMs?: number | null;
    cloud?: FakeCloud;
    /** on disk before the runtime boots, as a restart finds it. */
    credential?: DeviceCredential;
  } = {},
): Harness => {
  const dataDir = makeTempDir("inteligir-sync-");
  if (options.credential !== undefined) {
    writeDeviceCredential(dataDir, options.credential);
  }
  const db = createConnection(nodePath.join(dataDir, "inteligir.db"));
  runMigrations(db);
  const cloud = options.cloud ?? new FakeCloud();
  const vault = makeVault();
  const applied: Harness["applied"] = [];
  const socketOpens: OpenCloudSocketArgs[] = [];
  let vaultPings = 0;
  const statusNotices: CloudStatusResponse[] = [];
  const traced: string[] = [];
  // null before the constructor returns (a stored credential opens its session inside it) and
  // after the teardown closes the db status() reads.
  let asked: CloudRuntime | null = null;
  const sink: SyncedEventSink = {
    applySyncedEvents: (args) => {
      applied.push({
        cursor: args.cursor,
        events: args.rows.map((row) => row.event),
        threadId: args.threadId,
      });
      // the real sink writes the cursor in the apply's transaction; a stub that skips it replays every page.
      writeSyncCursor(db, args.cursor);
    },
  };
  const transport: CloudTransport = {
    fetch: options.fetch ?? cloud.fetch,
    openSocket: (args): CloudSocket => {
      socketOpens.push(args);
      return { close: () => {} };
    },
  };
  if (options.pollIntervalMs !== undefined) {
    transport.pollIntervalMs = options.pollIntervalMs;
  }
  const runtime = createCloudRuntime({
    build: "0.0.0-test",
    cloudUrl: CLOUD_URL,
    dataDir,
    db,
    debugLog: (line) => {
      traced.push(line);
    },
    onDebug: () => {},
    onStatusChanged: () => {
      if (asked !== null) {
        statusNotices.push(asked.status());
      }
    },
    onVaultPing: () => {
      vaultPings += 1;
    },
    transport,
    vault,
  });
  asked = runtime;
  runtime.attach(sink);
  onTestFinished(() => {
    asked = null;
    void runtime.dispose();
    closeConnection(db);
  });
  return {
    applied,
    cloud,
    dataDir,
    db,
    runtime,
    socketOpens,
    statusNotices,
    traced,
    vault,
    vaultPings: () => vaultPings,
  };
};

const message = (threadId: string, text: string): ThreadEvent => ({
  scope: threadScope(),
  text,
  threadId,
  type: "client/turn/requested",
});

const append = (harness: Harness, events: readonly ThreadEvent[]): void => {
  writeTransaction(harness.db, (tx) => {
    harness.runtime.enqueue(tx, events);
  });
};

const loginAs = async (runtime: CloudRuntime, deviceName: string): Promise<LoginOutcome> =>
  await runtime.login({ ...FAKE_ACCOUNT, deviceName });

const signIn = async (harness: Harness): Promise<string> => {
  const outcome = await loginAs(harness.runtime, "Laptop");
  if (outcome.kind !== "logged-in") {
    throw new Error(`login refused: ${JSON.stringify(outcome)}`);
  }
  return outcome.status.state === "signed-in" ? outcome.status.deviceId : "";
};

describe("sync is off until someone signs in", () => {
  it("opens no socket, arms no timer and makes no request", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();

    harness.runtime.start();
    append(harness, [message("thr_1", "a local message nobody asked to sync")]);
    // the poll interval is left at its shipping default on purpose.
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(harness.cloud.requests).toEqual([]);
    expect(harness.socketOpens).toEqual([]);
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
    expect(countSyncOutbox(harness.db)).toBe(0);
  });

  it("makes no request after a logout either, past the one that revokes the device", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    append(harness, [message("thr_1", "before")]);
    await harness.runtime.syncNow();
    const requestsWhileSignedIn = harness.cloud.requests.length;

    expect(harness.runtime.logout()).toEqual(SIGNED_OUT);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    append(harness, [message("thr_1", "after")]);
    await harness.runtime.syncNow();
    // settles the sign-out, which the logout itself never waits for.
    await harness.runtime.dispose();
    expect(harness.cloud.requests.slice(requestsWhileSignedIn)).toEqual([
      `POST ${DEVICE_API_PATHS.signOut}`,
    ]);
  });
});

describe("signing in", () => {
  it("logs in and leaves the credential in the data dir", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);

    const stored = readDeviceCredential(harness.dataDir);
    expect(stored?.credential).toMatch(/^igd_[0-9a-f]{64}$/u);
    expect(stored).toEqual({ credential: stored?.credential, deviceId, userId: "user_fake" });
    const status = harness.runtime.status();
    expect(status.state).toBe("signed-in");
  });

  it("retries the account identity on the next pass rather than losing vault sync for good", async () => {
    const cloud = new FakeCloud();
    let refusals = 1;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) => {
        if (new URL(input).pathname === ACCOUNT_API_PATHS.account && refusals > 0) {
          refusals -= 1;
          throw new Error("network is down");
        }
        return await cloud.fetch(input, init);
      },
      pollIntervalMs: null,
    });

    await signIn(harness);
    expect(readDeviceCredential(harness.dataDir)?.userId).toBeUndefined();
    const pingsWhileBlind = harness.vaultPings();

    await harness.runtime.syncNow();

    expect(readDeviceCredential(harness.dataDir)?.userId).toBe("user_fake");
    expect(harness.vaultPings()).toBe(pingsWhileBlind + 1);
  });

  it("reports the cloud's own refusal for a wrong password, and keeps nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const outcome = await harness.runtime.login({
      deviceName: "Laptop",
      email: FAKE_ACCOUNT.email,
      password: "not-the-password",
    });
    expect(outcome).toStrictEqual({
      failure: {
        code: "invalid-credentials",
        deviceSeq: null,
        kind: "refused",
        message: "Wrong email or password.",
      },
      kind: "refused",
    });
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("defaults the device name to this machine's hostname", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const outcome = await harness.runtime.login(FAKE_ACCOUNT);
    expect(outcome.kind).toBe("logged-in");
    expect(harness.cloud.deviceCount()).toBe(1);
  });

  it("replaces the previous account's queue and positions with a clean slate", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    append(harness, [message("thr_1", "queued under the first login")]);
    expect(countSyncOutbox(harness.db)).toBe(1);

    const second = await loginAs(harness.runtime, "Laptop again");
    expect(second.kind).toBe("logged-in");
    expect(readDeviceCredential(harness.dataDir)?.deviceId).toBe("dev_2");
    expect(countSyncOutbox(harness.db)).toBe(0);
  });

  it("is inert after dispose — a login landing during shutdown writes nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await harness.runtime.dispose();
    const outcome = await loginAs(harness.runtime, "Laptop");
    expect(outcome.kind).toBe("refused");
    expect(harness.cloud.requests).toEqual([]);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
  });
});

describe("a push interrupted mid-batch", () => {
  it("retries to no duplicate and no conflict", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    append(harness, [message("thr_1", "one"), message("thr_1", "two")]);

    harness.cloud.dropNextPushResponse = true;
    await harness.runtime.syncNow();
    expect(harness.cloud.logSize()).toBe(1);
    expect(countSyncOutbox(harness.db)).toBe(2);

    await harness.runtime.syncNow();
    expect(harness.cloud.logSize()).toBe(2);
    expect(countSyncOutbox(harness.db)).toBe(0);
    const status = harness.runtime.status();
    expect(status.state === "signed-in" ? status.lastError : "signed out").toBeNull();
  });
});

// no payload text to clip: the envelope alone is past the contract's per-event byte ceiling.
const unsendable = (threadId: string): ThreadEvent => ({
  item: {
    approvalStatus: null,
    changes: Array.from({ length: 3000 }, (_, index) => ({
      kind: "add",
      path: `notes/renamed-in-bulk-${index}.md`,
    })),
    id: "item_f",
    status: "completed",
    type: "fileChange",
  },
  scope: turnScope("turn_1"),
  threadId,
  type: "item/completed",
});

// answers the next push with the log's refusal at `deviceSeq`, then lets the rest through.
const refusingOnePush = (cloud: FakeCloud, deviceSeq: number): CloudFetch => {
  let refusals = 1;
  return async (input, init) => {
    if (refusals > 0 && new URL(input).pathname === SYNC_API_PATHS.push) {
      refusals -= 1;
      return Response.json(
        cloudError("sync-conflict", "That outbox position is already stored.", deviceSeq),
        { status: CLOUD_ERROR_STATUS["sync-conflict"] },
      );
    }
    return await cloud.fetch(input, init);
  };
};

describe("an event the cloud will never hold", () => {
  it("is counted when the contract refuses it, and the count outlives the next good pass", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);

    append(harness, [unsendable("thr_1"), message("thr_1", "gets through")]);
    expect(await harness.runtime.syncNow()).toMatchObject({ dropped: 1, pending: 0 });
    expect(harness.cloud.logSize()).toBe(1);

    append(harness, [message("thr_1", "a later pass with nothing refused")]);
    expect(await harness.runtime.syncNow()).toMatchObject({ dropped: 1, lastError: null });
  });

  it("is counted for every queued row the log refuses a batch through", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, fetch: refusingOnePush(cloud, 2), pollIntervalMs: null });
    await signIn(harness);

    append(harness, [message("thr_1", "one"), message("thr_1", "two"), message("thr_1", "three")]);
    expect(await harness.runtime.syncNow()).toMatchObject({ dropped: 2, pending: 0 });
    expect(cloud.logSize()).toBe(1);
  });

  it("is forgotten with the account at sign-out", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    append(harness, [unsendable("thr_1")]);
    expect(await harness.runtime.syncNow()).toMatchObject({ dropped: 1 });

    harness.runtime.logout();
    await signIn(harness);
    expect(harness.runtime.status()).toMatchObject({ dropped: 0, state: "signed-in" });
  });
});

describe("a capture delivered twice", () => {
  it("applies once", async () => {
    const cloud = new FakeCloud();
    let lapsed = false;
    // lapse every claim as the first ack goes out, so that ack owns nothing.
    const fetchWithLapse: CloudFetch = async (input, init) => {
      if (!lapsed && new URL(input).pathname === CAPTURE_API_PATHS.ack) {
        lapsed = true;
        cloud.lapseClaims();
      }
      return await cloud.fetch(input, init);
    };
    const harness = makeHarness({ fetch: fetchWithLapse, pollIntervalMs: null });
    // the login goes through the wrapped fetch, so it lands on the cloud that fetch reaches.
    const outcome = await loginAs(harness.runtime, "Laptop");
    expect(outcome.kind).toBe("logged-in");

    cloud.capture("buy oat milk");
    await harness.runtime.syncNow();
    expect(harness.vault.files.get(CAPTURE_INBOX_PATH)).toContain("buy oat milk");

    await harness.runtime.syncNow();
    const inbox = harness.vault.files.get(CAPTURE_INBOX_PATH) ?? "";
    expect(inbox.match(/buy oat milk/gu)).toHaveLength(1);
  });
});

describe("a revoked device", () => {
  it("fails closed and surfaces as unauthorized rather than retrying forever", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);
    append(harness, [message("thr_1", "before the revoke")]);
    await harness.runtime.syncNow();
    expect(harness.cloud.logSize()).toBe(1);

    harness.cloud.revoke(deviceId);
    append(harness, [message("thr_1", "after the revoke")]);
    await harness.runtime.syncNow();

    const status = harness.runtime.status();
    expect(status.state).toBe("unauthorized");
    if (status.state !== "unauthorized") {
      throw new Error("expected unauthorized");
    }
    expect(status.deviceId).toBe(deviceId);

    const requestsAtRefusal = harness.cloud.requests.length;
    await harness.runtime.syncNow();
    await harness.runtime.syncNow();
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });
});

type Json = z.infer<ReturnType<typeof z.json>>;

const jsonArraySchema = z.array(z.json());
const jsonObjectSchema = z.record(z.string(), z.json());

// every object a newer worker answers gains a field this build never declared, except an event
// body, which the wire carries opaque
const grown = (value: Json): Json => {
  const array = jsonArraySchema.safeParse(value);
  if (array.success) {
    return array.data.map(grown);
  }
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) {
    return value;
  }
  return {
    ...Object.fromEntries(
      Object.entries(object.data).map(([key, inner]) => [
        key,
        key === "event" ? inner : grown(inner),
      ]),
    ),
    addedByANewerWorker: { nested: [1] },
  };
};

const fromANewerWorker =
  (cloud: FakeCloud): CloudFetch =>
  async (input, init) => {
    const response = await cloud.fetch(input, init);
    const body = z.json().parse(await response.json());
    return Response.json(grown(body), { status: response.status });
  };

describe("a worker newer than this build", () => {
  it("signs in, pushes, pulls, claims and acks through answers that grew a field", async () => {
    const cloud = new FakeCloud();
    const peer = makeHarness({ cloud, pollIntervalMs: null });
    await signIn(peer);
    append(peer, [message("thr_peer", "from the other device")]);
    await peer.runtime.syncNow();

    const harness = makeHarness({ cloud, fetch: fromANewerWorker(cloud), pollIntervalMs: null });
    await signIn(harness);
    append(harness, [message("thr_mine", "from this device")]);
    cloud.capture("buy oat milk");
    const status = await harness.runtime.syncNow();

    expect(status).toMatchObject({ lastError: null, state: "signed-in" });
    expect(harness.applied.map((batch) => batch.threadId)).toEqual(["thr_peer"]);
    expect(cloud.logSize()).toBe(2);
    expect(harness.vault.files.get(CAPTURE_INBOX_PATH)).toContain("buy oat milk");
    expect(readDeviceCredential(harness.dataDir)?.userId).toBe("user_fake");
  });

  it("still hears a revocation whose refusal grew a field", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, fetch: fromANewerWorker(cloud), pollIntervalMs: null });
    const deviceId = await signIn(harness);

    cloud.revoke(deviceId);
    await harness.runtime.syncNow();

    expect(harness.runtime.status().state).toBe("unauthorized");
  });

  it("reads a refusal code it does not know as a fault to retry, in the worker's words", async () => {
    const cloud = new FakeCloud();
    let paused = false;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) =>
        paused && new URL(input).pathname === SYNC_API_PATHS.pull
          ? Response.json(
              { error: { code: "account-paused", message: "This account is paused." } },
              { status: 403 },
            )
          : await cloud.fetch(input, init),
      pollIntervalMs: null,
    });
    await signIn(harness);

    paused = true;
    const refused = await harness.runtime.syncNow();
    expect(refused.state).toBe("signed-in");
    expect(refused.state === "signed-in" ? refused.lastError : null).toMatch(
      /This account is paused\./u,
    );

    paused = false;
    expect(await harness.runtime.syncNow()).toMatchObject({ lastError: null, state: "signed-in" });
  });
});

describe("the sync trace", () => {
  it("names where each step of a pass stopped and a ping it skipped, and no message", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const [dial] = harness.socketOpens;
    if (dial === undefined) {
      throw new Error("expected a socket dial");
    }
    append(harness, [message("thr_1", "the secret the user typed")]);
    await harness.runtime.syncNow();
    dial.onPing({ seq: 0, type: "sync" });

    for (const line of [
      /^session \d+ push: caught-up$/u,
      /^pulled 1 row\(s\) after \d+: 0 to apply across 0 thread\(s\), 1 skipped as this device's own or unreadable$/u,
      /^session \d+ pull: caught-up$/u,
      /^session \d+ captures: caught-up$/u,
      /^session \d+ pass: caught-up$/u,
      /^sync ping at 0 skipped: the cursor \d+ covers it$/u,
    ]) {
      expect(
        harness.traced.some((traced) => line.test(traced)),
        String(line),
      ).toBe(true);
    }
    expect(harness.traced.join("\n")).not.toContain("secret");
  });
});

describe("the invalidation socket", () => {
  it("ignores a sync ping this device's cursor already covers", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const [dial] = harness.socketOpens;
    if (dial === undefined) {
      throw new Error("expected a socket dial");
    }
    const quiet = harness.cloud.requests.length;

    dial.onPing({ seq: 0, type: "sync" });
    await harness.runtime.syncNow();
    const afterCovered = harness.cloud.requests.length;

    dial.onPing({ seq: 99, type: "sync" });
    await harness.runtime.syncNow();
    expect(afterCovered).toBeGreaterThan(quiet);
    expect(harness.cloud.requests.length).toBeGreaterThan(afterCovered);
  });

  it("routes a vault ping to the vault hook and starts no thread pass", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const [dial] = harness.socketOpens;
    if (dial === undefined) {
      throw new Error("expected a socket dial");
    }
    // one from the login, one from the account-identity learner.
    expect(harness.vaultPings()).toBe(2);
    const quiet = harness.cloud.requests.length;

    dial.onPing({ type: "vault" });
    expect(harness.vaultPings()).toBe(3);
    expect(harness.cloud.requests).toHaveLength(quiet);
  });

  it("re-dials after a close, and a severed socket turns into a refusal", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);
    const [dial] = harness.socketOpens;
    if (dial === undefined) {
      throw new Error("expected a socket dial");
    }

    harness.cloud.revoke(deviceId);
    dial.onClose(SYNC_WS_REVOKED_CLOSE_CODE);
    await harness.runtime.syncNow();
    expect(harness.runtime.status().state).toBe("unauthorized");
  });

  it("catches up once it opens: a ping sent while it was down reached nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const [dial] = harness.socketOpens;
    if (dial === undefined) {
      throw new Error("expected a socket dial");
    }
    const quiet = harness.cloud.requests.length;

    dial.onOpen();

    await vi.waitFor(() => {
      expect(harness.cloud.requests.length).toBeGreaterThan(quiet);
    });
    // joins the requested pass, so the teardown does not close the db under it.
    await harness.runtime.syncNow();
    expect(harness.statusNotices).toContainEqual(expect.objectContaining({ connected: true }));
  });
});

describe("the status bus", () => {
  it("announces a sign-in, the end of every pass and a revocation, so nothing polls", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);
    expect(harness.statusNotices.at(-1)).toMatchObject({ deviceId, state: "signed-in" });

    harness.statusNotices.length = 0;
    append(harness, [message("thr_1", "pushed by the next pass")]);
    await harness.runtime.syncNow();
    expect(harness.statusNotices.at(-1)).toMatchObject({ pending: 0, state: "signed-in" });

    harness.cloud.revoke(deviceId);
    await harness.runtime.syncNow();
    expect(harness.statusNotices).toContainEqual(
      expect.objectContaining({ state: "unauthorized" }),
    );
  });
});

describe("a pass that did not reach the cloud", () => {
  it("leaves lastSyncedAt where the last whole pass put it, and says why", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const cloud = new FakeCloud();
    let offline = false;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) => {
        if (offline && new URL(input).pathname === SYNC_API_PATHS.pull) {
          throw new Error("network is down");
        }
        return await cloud.fetch(input, init);
      },
      pollIntervalMs: null,
    });
    await signIn(harness);
    expect(harness.runtime.status()).toMatchObject({ lastError: null, lastSyncedAt: 1_000_000 });

    offline = true;
    vi.setSystemTime(2_000_000);
    const after = await harness.runtime.syncNow();

    expect(after).toMatchObject({ lastSyncedAt: 1_000_000, state: "signed-in" });
    expect(after.state === "signed-in" ? after.lastError : null).toMatch(/network is down/u);
  });

  it("keeps a failed push's error when the pull after it succeeds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const cloud = new FakeCloud();
    let pushDown = false;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) =>
        pushDown && new URL(input).pathname === SYNC_API_PATHS.push
          ? new Response(null, { status: 503 })
          : await cloud.fetch(input, init),
      pollIntervalMs: null,
    });
    await signIn(harness);

    pushDown = true;
    append(harness, [message("thr_1", "the push cannot land")]);
    vi.setSystemTime(2_000_000);
    const after = await harness.runtime.syncNow();

    expect(after).toMatchObject({ lastSyncedAt: 1_000_000, pending: 1, state: "signed-in" });
    expect(after.state === "signed-in" ? after.lastError : null).toMatch(/HTTP 503/u);
  });

  it("says why a capture it claimed could not be written", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    harness.vault.writeGuarded = async () =>
      await Promise.resolve({ applied: false, reason: "exists" });

    harness.cloud.capture("buy oat milk");
    const after = await harness.runtime.syncNow();

    expect(after.state === "signed-in" ? after.lastError : null).toMatch(
      /appeared under the capture write/u,
    );
  });
});

// pages of one row, so three passes' worth of pages is a few dozen rows rather than fifteen thousand.
const onePerPage =
  (cloud: FakeCloud, onPull: () => void = () => {}): CloudFetch =>
  async (input, init) => {
    const url = new URL(input);
    if (url.pathname === SYNC_API_PATHS.pull) {
      url.searchParams.set("limit", "1");
      onPull();
    }
    return await cloud.fetch(url.toString(), init);
  };

const BACKLOG = 3 * MAX_PULL_PAGES_PER_PASS;

const writeBacklog = async (cloud: FakeCloud): Promise<void> => {
  const writer = makeHarness({ cloud, pollIntervalMs: null });
  await signIn(writer);
  append(
    writer,
    Array.from({ length: BACKLOG }, (_, index) => message("thr_backlog", `row ${index}`)),
  );
  await writer.runtime.syncNow();
  expect(cloud.logSize()).toBe(BACKLOG);
};

describe("a backlog past one pass's cap", () => {
  it("is applied whole by one sync, and only its last pass is stamped synced", async () => {
    const cloud = new FakeCloud();
    await writeBacklog(cloud);
    const stampsAtPull: (number | null)[] = [];
    let reader: Harness | null = null;
    reader = makeHarness({
      cloud,
      fetch: onePerPage(cloud, () => {
        if (reader !== null) {
          stampsAtPull.push(readSyncState(reader.db).lastSyncedAt);
        }
      }),
      pollIntervalMs: null,
    });

    // the login's pass is the one sync: it starts from an empty cursor with the whole log ahead.
    await loginAs(reader.runtime, "Reader");

    expect(readSyncState(reader.db).cursor).toBe(BACKLOG);
    expect(reader.applied.flatMap((entry) => entry.events)).toHaveLength(BACKLOG);
    // three capped passes of one-row pages, back to back.
    expect(stampsAtPull).toHaveLength(BACKLOG);
    expect(stampsAtPull.filter((stamp) => stamp !== null)).toEqual([]);
    expect(readSyncState(reader.db).lastSyncedAt).not.toBeNull();
  });

  it("holds a teardown for the pass it lands in, not for the backlog behind it", async () => {
    const cloud = new FakeCloud();
    await writeBacklog(cloud);
    let pulls = 0;
    let runtime: CloudRuntime | null = null;
    const reader = makeHarness({
      cloud,
      fetch: onePerPage(cloud, () => {
        pulls += 1;
        // the first page of the second pass.
        if (pulls === MAX_PULL_PAGES_PER_PASS + 1) {
          void runtime?.dispose();
        }
      }),
      pollIntervalMs: null,
    });
    ({ runtime } = reader);

    // resolves once the flight settles, which is the wait a teardown has.
    await loginAs(reader.runtime, "Reader");

    expect(pulls).toBe(MAX_PULL_PAGES_PER_PASS + 1);
    expect(readSyncState(reader.db).cursor).toBe(MAX_PULL_PAGES_PER_PASS);
  });
});

// holds the first call to one path until released; honours the abort signal.
interface Gate {
  fetch: CloudFetch;
  /** inert until armed, so a login's own pass runs through. */
  arm: () => void;
  reached: Promise<void>;
  release: () => void;
}

// "before" holds the request (cancellable); "after" holds the response of a
// completed request, the window cancellation cannot reach.
type GateWhen = "before" | "after";

const gatedFetch = (cloud: FakeCloud, path: string, when: GateWhen = "before"): Gate => {
  const reachedGate: PromiseWithResolvers<void> = Promise.withResolvers();
  const heldGate: PromiseWithResolvers<void> = Promise.withResolvers();
  const { promise: reached, resolve: announce } = reachedGate;
  const { promise: held, resolve: open } = heldGate;
  let armed = false;
  let fired = false;
  const fetch: CloudFetch = async (input, init) => {
    const gating = armed && !fired && new URL(input).pathname === path;
    if (!gating) {
      return await cloud.fetch(input, init);
    }
    fired = true;
    if (when === "before") {
      announce();
      const aborted: PromiseWithResolvers<void> = Promise.withResolvers();
      init?.signal?.addEventListener("abort", () => {
        aborted.reject(new Error("aborted"));
      });
      await Promise.race([held, aborted.promise]);
      return await cloud.fetch(input, init);
    }
    // no abort race here: the request already completed, and an abort cannot un-resolve it.
    const response = await cloud.fetch(input, init);
    announce();
    await held;
    return response;
  };
  return {
    arm: () => {
      armed = true;
    },
    fetch,
    reached,
    release: open,
  };
};

const waitForLogin = async (runtime: CloudRuntime, deviceId: string): Promise<void> => {
  await vi.waitFor(() => {
    const status = runtime.status();
    expect(status.state === "signed-in" ? status.deviceId : null).toBe(deviceId);
  });
};

describe("a session that changes mid-pass", () => {
  it("does not let a finished session's ack delete the next one's queue", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, SYNC_API_PATHS.push, "after");
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await loginAs(harness.runtime, "Laptop");
    append(harness, [message("thr_1", "belongs to the first login")]);

    gate.arm();
    const pass = harness.runtime.syncNow();
    await gate.reached;

    // not awaited: login waits on the very pass the gate is holding.
    const signedInAgain = loginAs(harness.runtime, "Laptop again");
    await waitForLogin(harness.runtime, "dev_2");

    append(harness, [message("thr_1", "belongs to the second login")]);

    gate.release();
    await signedInAgain;
    await pass;

    expect(cloud.logSize()).toBe(2);
    expect(countSyncOutbox(harness.db)).toBe(0);
  });

  it("does not apply one account's page into a login to another", async () => {
    const leaving = makeHarness({ pollIntervalMs: null });
    await signIn(leaving);
    append(leaving, [message("thr_leaving", "from the account being left")]);
    await leaving.runtime.syncNow();

    const joining = makeHarness({ pollIntervalMs: null });
    await signIn(joining);
    append(joining, [message("thr_joining", "from the account being joined")]);
    await joining.runtime.syncNow();

    let current = leaving.cloud;
    const gate = gatedFetch(leaving.cloud, SYNC_API_PATHS.pull, "after");
    const reader = makeHarness({
      cloud: leaving.cloud,
      fetch: async (input, init) =>
        current === leaving.cloud
          ? await gate.fetch(input, init)
          : await current.fetch(input, init),
      pollIntervalMs: null,
    });
    await loginAs(reader.runtime, "Reader");

    append(leaving, [message("thr_leaving", "the page held mid-flight")]);
    await leaving.runtime.syncNow();
    reader.applied.length = 0;
    gate.arm();
    const pass = reader.runtime.syncNow();
    await gate.reached;

    current = joining.cloud;
    const signedInAgain = loginAs(reader.runtime, "Reader elsewhere");
    // not waitForLogin: the reader is already dev_2 on leaving.cloud, so it would
    // resolve before the session swap. the login landing on joining.cloud is the signal.
    await vi.waitFor(() => {
      expect(joining.cloud.deviceCount()).toBe(2);
    });
    // let openSession's microtask drain before releasing the held page.
    await Promise.resolve();
    reader.applied.length = 0;

    gate.release();
    await signedInAgain;
    await pass;

    expect(reader.applied.length).toBeGreaterThan(0);
    expect(reader.applied.map((entry) => entry.threadId)).not.toContain("thr_leaving");
  });
});

describe("dispose", () => {
  it("cancels the pass rather than waiting it out", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, SYNC_API_PATHS.pull);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await loginAs(harness.runtime, "Laptop");
    cloud.capture("something the inbox is holding");

    gate.arm();
    const pass = harness.runtime.syncNow();
    await gate.reached;
    const requestsAtDispose = cloud.requests.length;

    await harness.runtime.dispose();
    gate.release();
    await pass;

    expect(cloud.requests.slice(requestsAtDispose)).toEqual([]);
    expect(harness.vault.files.get(CAPTURE_INBOX_PATH)).toBeUndefined();
  });
});

// a logout never waits for its sign-out, so the cloud's side lands a beat later
const activeDevicesSettle = async (cloud: FakeCloud, count: number): Promise<void> => {
  await vi.waitFor(() => {
    expect(cloud.activeDeviceCount()).toBe(count);
  });
};

describe("signing out", () => {
  it("gives the device's slot back, so sign-in cycles never meet the account's cap", async () => {
    const cloud = new FakeCloud();
    cloud.maxDevices = 20;
    const harness = makeHarness({ cloud, pollIntervalMs: null });

    for (let cycle = 0; cycle < 25; cycle += 1) {
      const outcome = await loginAs(harness.runtime, `Laptop ${cycle}`);
      expect(outcome.kind).toBe("logged-in");
      harness.runtime.logout();
      await activeDevicesSettle(cloud, 0);
    }
    expect(cloud.deviceCount()).toBe(25);
  });

  it("gives the previous sign-in's slot back when signing in again without signing out", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    await loginAs(harness.runtime, "Laptop again");

    await activeDevicesSettle(harness.cloud, 1);
    expect(harness.runtime.status()).toMatchObject({ deviceId: "dev_2", state: "signed-in" });
  });

  it("lands after the session it ended, and a shutdown waits for it", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, DEVICE_API_PATHS.signOut);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await signIn(harness);

    gate.arm();
    harness.runtime.logout();
    await gate.reached;
    let disposed = false;
    const disposing = (async () => {
      await harness.runtime.dispose();
      disposed = true;
    })();
    await tick();
    expect(disposed).toBe(false);

    gate.release();
    await disposing;
    expect(cloud.activeDeviceCount()).toBe(0);
  });

  it("holds a shutdown for a sign-out the cloud never answers only until the grace runs out", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, DEVICE_API_PATHS.signOut);
    const harness = makeHarness({ cloud, fetch: gate.fetch, pollIntervalMs: null });
    await signIn(harness);

    gate.arm();
    harness.runtime.logout();
    await gate.reached;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let disposed = false;
    const disposing = (async () => {
      await harness.runtime.dispose();
      disposed = true;
    })();
    await vi.advanceTimersByTimeAsync(2999);
    expect(disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await disposing;
    expect(cloud.activeDeviceCount()).toBe(1);
  });

  it("signs out here even when the cloud cannot hear it", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) => {
        if (new URL(input).pathname === DEVICE_API_PATHS.signOut) {
          throw new Error("network is down");
        }
        return await cloud.fetch(input, init);
      },
      pollIntervalMs: null,
    });
    await signIn(harness);

    expect(harness.runtime.logout()).toEqual(SIGNED_OUT);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    await harness.runtime.dispose();
    expect(cloud.activeDeviceCount()).toBe(1);
  });

  it("says a revoke the cloud did not take on the signed-out status, until the next login", async () => {
    const cloud = new FakeCloud();
    let signOutDown = true;
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) =>
        signOutDown && new URL(input).pathname === DEVICE_API_PATHS.signOut
          ? new Response(null, { status: 503 })
          : await cloud.fetch(input, init),
      pollIntervalMs: null,
    });
    await signIn(harness);

    expect(harness.runtime.logout()).toEqual(SIGNED_OUT);
    await vi.waitFor(() => {
      expect(harness.runtime.status()).toMatchObject({
        revokeError: expect.stringMatching(/HTTP 503/u),
        state: "signed-out",
      });
    });
    expect(harness.statusNotices.at(-1)).toMatchObject({ revokeError: expect.any(String) });

    signOutDown = false;
    await signIn(harness);
    harness.runtime.logout();
    await activeDevicesSettle(cloud, 1);
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("says nothing for a revoke the cloud refused because the device was already gone", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    harness.cloud.revoke(await signIn(harness));

    harness.runtime.logout();
    await harness.runtime.dispose();
    expect(harness.runtime.status()).toEqual(SIGNED_OUT);
  });

  it("asks nothing of the cloud for a credential it already refused", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    harness.cloud.revoke(await signIn(harness));
    await harness.runtime.syncNow();
    expect(harness.runtime.status().state).toBe("unauthorized");
    const requestsAtRefusal = harness.cloud.requests.length;

    harness.runtime.logout();
    await harness.runtime.dispose();
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });
});

describe("every cloud call carries a deadline", () => {
  it("attaches a signal to every request, login included", async () => {
    const cloud = new FakeCloud();
    const signalled: { path: string; hasSignal: boolean }[] = [];
    const harness = makeHarness({
      cloud,
      fetch: async (input, init) => {
        signalled.push({
          hasSignal: init?.signal instanceof AbortSignal,
          path: new URL(input).pathname,
        });
        return await cloud.fetch(input, init);
      },
      pollIntervalMs: null,
    });
    cloud.capture("so the capture calls happen too");
    await signIn(harness);
    append(harness, [message("thr_1", "so the push happens too")]);
    await harness.runtime.syncNow();

    expect(signalled.length).toBeGreaterThan(4);
    expect(signalled.filter((call) => !call.hasSignal)).toEqual([]);
  });
});

describe("applying the account's log", () => {
  it("commits each retried row's OWN position, never the group's", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, pollIntervalMs: null });
    const writer = makeHarness({ cloud, pollIntervalMs: null });
    await signIn(writer);
    append(writer, [message("thr_1", "one"), message("thr_1", "two"), message("thr_1", "three")]);
    await writer.runtime.syncNow();

    // refuses every group (forcing the per-row retry) and one row outright.
    const cursors: number[] = [];
    harness.runtime.attach({
      applySyncedEvents: (args) => {
        if (args.rows.length > 1) {
          throw new Error("the group is refused");
        }
        const [only] = args.rows;
        if (only?.event.type === "client/turn/requested" && only.event.text === "two") {
          throw new MissingTurnStartedError({
            eventType: only.event.type,
            threadId: args.threadId,
            turnId: "turn_never_started",
          });
        }
        cursors.push(args.cursor);
        writeSyncCursor(harness.db, args.cursor);
      },
    });
    await loginAs(harness.runtime, "Reader");

    expect(cursors).toEqual([1, 3]);
    expect(readSyncState(harness.db).cursor).toBe(3);
  });

  it("never moves past a row for a fault the log did not refuse: the pass fails and says so", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, pollIntervalMs: null });
    const writer = makeHarness({ cloud, pollIntervalMs: null });
    await signIn(writer);
    append(writer, [message("thr_1", "one"), message("thr_1", "two"), message("thr_1", "three")]);
    await writer.runtime.syncNow();

    harness.runtime.attach({
      applySyncedEvents: (args) => {
        const [only] = args.rows;
        if (
          args.rows.length > 1 ||
          (only?.event.type === "client/turn/requested" && only.event.text === "two")
        ) {
          throw new Error("the disk is full");
        }
        writeSyncCursor(harness.db, args.cursor);
      },
    });
    await loginAs(harness.runtime, "Reader");

    expect(readSyncState(harness.db).cursor).toBe(1);
    expect(harness.runtime.status()).toMatchObject({
      lastError: "the disk is full",
      lastSyncedAt: null,
    });
  });

  it("still lands the captures while a row it cannot apply holds the cursor", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ cloud, pollIntervalMs: null });
    const writer = makeHarness({ cloud, pollIntervalMs: null });
    await signIn(writer);
    append(writer, [message("thr_1", "one")]);
    await writer.runtime.syncNow();

    harness.runtime.attach({
      applySyncedEvents: () => {
        throw new Error("the disk is full");
      },
    });
    cloud.capture("buy oat milk");
    await loginAs(harness.runtime, "Reader");

    expect(readSyncState(harness.db).cursor).toBe(0);
    expect(harness.vault.files.get(CAPTURE_INBOX_PATH)).toContain("buy oat milk");
    expect(harness.runtime.status()).toMatchObject({
      lastError: "the disk is full",
      lastSyncedAt: null,
    });
  });

  it("skips this device's own rows and settles the cursor on the rest", async () => {
    const writer = makeHarness({ pollIntervalMs: null });
    const { cloud } = writer;
    await signIn(writer);
    append(writer, [message("thr_shared", "from the writer")]);
    await writer.runtime.syncNow();
    expect(writer.applied).toEqual([]);

    const reader = makeHarness({ fetch: cloud.fetch, pollIntervalMs: null });
    const signedIn = await loginAs(reader.runtime, "Desktop");
    expect(signedIn.kind).toBe("logged-in");

    await reader.runtime.syncNow();
    expect(reader.applied).toHaveLength(1);
    expect(reader.applied[0]?.threadId).toBe("thr_shared");
    expect(reader.applied[0]?.events[0]).toEqual(message("thr_shared", "from the writer"));
    expect(reader.applied[0]?.cursor).toBe(1);
  });

  it("skips rows written under the id it booted with, after signing in again", async () => {
    const cloud = new FakeCloud();
    const earlier = makeHarness({ cloud, pollIntervalMs: null });
    await signIn(earlier);
    append(earlier, [message("thr_mine", "written under the first sign-in")]);
    await earlier.runtime.syncNow();
    const credential = readDeviceCredential(earlier.dataDir);
    if (credential === null) {
      throw new Error("expected a stored credential");
    }

    // a database that never saw the sign-in happen: only the boot can have recorded its id.
    const restarted = makeHarness({ cloud, credential, pollIntervalMs: null });
    const again = await loginAs(restarted.runtime, "Laptop again");
    expect(again.kind).toBe("logged-in");

    expect(restarted.applied).toEqual([]);
    expect(readSyncState(restarted.db).cursor).toBe(1);
  });
});
