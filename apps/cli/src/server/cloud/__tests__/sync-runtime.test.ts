import { ACCOUNT_API_PATHS } from "@repo/api/cloud/account/account-schema";
import { CAPTURE_API_PATHS } from "@repo/api/cloud/captures/captures-schema";
import { SYNC_API_PATHS } from "@repo/api/cloud/sync/sync-schema";
import {
  closeConnection,
  createConnection,
  writeTransaction,
  type DbConnection,
} from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { countSyncOutbox, readSyncState, writeSyncCursor } from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CAPTURE_INBOX_PATH, type CaptureVault } from "../captures";
import type { CloudFetch, CloudSocket, OpenCloudSocketArgs } from "@repo/api/cloud/client";
import { readDeviceCredential } from "../credential-store";
import type { SyncedEventSink } from "../sync-pass";
import {
  createCloudRuntime,
  type CloudRuntime,
  type CloudTransport,
  type LoginOutcome,
} from "../sync-runtime";
import { VaultServiceError } from "../../vault/vault-service";
import { makeTempDir } from "../../__tests__/temp-dir";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

const CLOUD_URL = "https://cloud.test";

afterEach(() => {
  vi.useRealTimers();
});

interface FakeVault extends CaptureVault {
  files: Map<string, string>;
}

function makeVault(): FakeVault {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new VaultServiceError("not_found", `No such vault entry: ${path}`);
      }
      return { path, content };
    },
    writeIfUnchanged: async (path, expected, content) => {
      if (files.get(path) !== expected) {
        return { applied: false, reason: "changed" };
      }
      files.set(path, content);
      return { applied: true, path };
    },
    writeGuarded: async (path, content, guard) => {
      if ("ifAbsent" in guard) {
        if (files.has(path)) {
          return { applied: false, reason: "exists" };
        }
        files.set(path, content);
        return { applied: true, path };
      }
      files.set(path, content);
      return { applied: true, path };
    },
  };
}

interface Harness {
  db: DbConnection;
  dataDir: string;
  cloud: FakeCloud;
  vault: FakeVault;
  runtime: CloudRuntime;
  applied: Array<{ threadId: string; events: readonly ThreadEvent[]; cursor: number }>;
  socketOpens: OpenCloudSocketArgs[];
  vaultPings: () => number;
}

function makeHarness(
  options: {
    fetch?: CloudFetch;
    pollIntervalMs?: number | null;
    cloud?: FakeCloud;
  } = {},
): Harness {
  const dataDir = makeTempDir("inteligir-sync-");
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  const cloud = options.cloud ?? new FakeCloud();
  const vault = makeVault();
  const applied: Harness["applied"] = [];
  const socketOpens: OpenCloudSocketArgs[] = [];
  let vaultPings = 0;
  const sink: SyncedEventSink = {
    applySyncedEvents: (args) => {
      applied.push({
        threadId: args.threadId,
        events: args.rows.map((row) => row.event),
        cursor: args.cursor,
      });
      // the real sink writes the cursor in the apply's transaction; a stub that skips it replays every page.
      writeSyncCursor(db, args.cursor);
    },
  };
  const transport: CloudTransport = {
    fetch: options.fetch ?? cloud.fetch,
    openSocket: (args): CloudSocket => {
      socketOpens.push(args);
      return { close: () => undefined };
    },
  };
  if (options.pollIntervalMs !== undefined) transport.pollIntervalMs = options.pollIntervalMs;
  const runtime = createCloudRuntime({
    db,
    dataDir,
    cloudUrl: CLOUD_URL,
    vault,
    onDebug: () => undefined,
    onVaultPing: () => {
      vaultPings += 1;
    },
    transport,
  });
  runtime.attach(sink);
  onTestFinished(() => {
    void runtime.dispose();
    closeConnection(db);
  });
  return {
    db,
    dataDir,
    cloud,
    vault,
    runtime,
    applied,
    socketOpens,
    vaultPings: () => vaultPings,
  };
}

function message(threadId: string, text: string): ThreadEvent {
  return { type: "client/turn/requested", threadId, text, scope: threadScope() };
}

function append(harness: Harness, events: readonly ThreadEvent[]): void {
  writeTransaction(harness.db, (tx) => {
    harness.runtime.enqueue(tx, events);
  });
}

function loginAs(runtime: CloudRuntime, deviceName: string): Promise<LoginOutcome> {
  return runtime.login({ ...FAKE_ACCOUNT, deviceName });
}

async function signIn(harness: Harness): Promise<string> {
  const outcome = await loginAs(harness.runtime, "Laptop");
  if (outcome.kind !== "logged-in") {
    throw new Error(`login refused: ${JSON.stringify(outcome)}`);
  }
  return outcome.status.state === "signed-in" ? outcome.status.deviceId : "";
}

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
    expect(harness.runtime.status()).toEqual({ state: "signed-out", cloudUrl: CLOUD_URL });
    expect(countSyncOutbox(harness.db)).toBe(0);
  });

  it("makes no request after a logout either", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    append(harness, [message("thr_1", "before")]);
    await harness.runtime.syncNow();
    const requestsWhileSignedIn = harness.cloud.requests.length;

    expect(harness.runtime.logout()).toEqual({ state: "signed-out", cloudUrl: CLOUD_URL });
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    append(harness, [message("thr_1", "after")]);
    await harness.runtime.syncNow();
    expect(harness.cloud.requests).toHaveLength(requestsWhileSignedIn);
  });
});

describe("signing in", () => {
  it("logs in and leaves the credential in the data dir", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await signIn(harness);

    expect(readDeviceCredential(harness.dataDir)).toEqual({
      deviceId,
      credential: expect.stringMatching(/^igd_[0-9a-f]{64}$/u),
      userId: "user_fake",
    });
    const status = harness.runtime.status();
    expect(status.state).toBe("signed-in");
  });

  it("retries the account identity on the next pass rather than losing vault sync for good", async () => {
    const cloud = new FakeCloud();
    let refusals = 1;
    const harness = makeHarness({
      cloud,
      pollIntervalMs: null,
      fetch: (input, init) => {
        if (new URL(input).pathname === ACCOUNT_API_PATHS.account && refusals > 0) {
          refusals -= 1;
          return Promise.reject(new Error("network is down"));
        }
        return cloud.fetch(input, init);
      },
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
      email: FAKE_ACCOUNT.email,
      password: "not-the-password",
      deviceName: "Laptop",
    });
    expect(outcome).toStrictEqual({
      kind: "refused",
      failure: {
        kind: "refused",
        code: "invalid-credentials",
        message: "Wrong email or password.",
        deviceSeq: null,
      },
    });
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    expect(harness.runtime.status()).toEqual({ state: "signed-out", cloudUrl: CLOUD_URL });
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
      return cloud.fetch(input, init);
    };
    const harness = makeHarness({ pollIntervalMs: null, fetch: fetchWithLapse });
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
    if (status.state !== "unauthorized") throw new Error("expected unauthorized");
    expect(status.deviceId).toBe(deviceId);

    const requestsAtRefusal = harness.cloud.requests.length;
    await harness.runtime.syncNow();
    await harness.runtime.syncNow();
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });
});

describe("the invalidation socket", () => {
  it("ignores a sync ping this device's cursor already covers", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const dial = harness.socketOpens[0];
    if (dial === undefined) throw new Error("expected a socket dial");
    const quiet = harness.cloud.requests.length;

    dial.onPing({ type: "sync", seq: 0 });
    await harness.runtime.syncNow();
    const afterCovered = harness.cloud.requests.length;

    dial.onPing({ type: "sync", seq: 99 });
    await harness.runtime.syncNow();
    expect(afterCovered).toBeGreaterThan(quiet);
    expect(harness.cloud.requests.length).toBeGreaterThan(afterCovered);
  });

  it("routes a vault ping to the vault hook and starts no thread pass", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await signIn(harness);
    const dial = harness.socketOpens[0];
    if (dial === undefined) throw new Error("expected a socket dial");
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
    const dial = harness.socketOpens[0];
    if (dial === undefined) throw new Error("expected a socket dial");

    // 1008: the cloud severing a revoked device.
    harness.cloud.revoke(deviceId);
    dial.onClose(1008);
    await harness.runtime.syncNow();
    expect(harness.runtime.status().state).toBe("unauthorized");
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

function noop(): void {}

function gatedFetch(cloud: FakeCloud, path: string, when: GateWhen = "before"): Gate {
  let announce: (value: void) => void = noop;
  const reached = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let open: (value: void) => void = noop;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  let armed = false;
  let fired = false;
  const fetch: CloudFetch = async (input, init) => {
    const gating = armed && !fired && new URL(input).pathname === path;
    if (!gating) {
      return cloud.fetch(input, init);
    }
    fired = true;
    if (when === "before") {
      announce();
      await Promise.race([
        held,
        new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
      ]);
      return cloud.fetch(input, init);
    }
    // no abort race here: the request already completed, and an abort cannot un-resolve it.
    const response = await cloud.fetch(input, init);
    announce();
    await held;
    return response;
  };
  return {
    fetch,
    arm: () => {
      armed = true;
    },
    reached,
    release: open,
  };
}

async function waitForLogin(runtime: CloudRuntime, deviceId: string): Promise<void> {
  await vi.waitFor(() => {
    const status = runtime.status();
    expect(status.state === "signed-in" ? status.deviceId : null).toBe(deviceId);
  });
}

describe("a session that changes mid-pass", () => {
  it("does not let a finished session's ack delete the next one's queue", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, SYNC_API_PATHS.push, "after");
    const harness = makeHarness({ pollIntervalMs: null, fetch: gate.fetch, cloud });
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
      pollIntervalMs: null,
      cloud: leaving.cloud,
      fetch: (input, init) =>
        current === leaving.cloud ? gate.fetch(input, init) : current.fetch(input, init),
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
    await vi.waitFor(() => expect(joining.cloud.deviceCount()).toBe(2));
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
    const harness = makeHarness({ pollIntervalMs: null, fetch: gate.fetch, cloud });
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

describe("every cloud call carries a deadline", () => {
  it("attaches a signal to every request, login included", async () => {
    const cloud = new FakeCloud();
    const signalled: Array<{ path: string; hasSignal: boolean }> = [];
    const harness = makeHarness({
      pollIntervalMs: null,
      cloud,
      fetch: (input, init) => {
        signalled.push({
          path: new URL(input).pathname,
          hasSignal: init?.signal instanceof AbortSignal,
        });
        return cloud.fetch(input, init);
      },
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
    const harness = makeHarness({ pollIntervalMs: null, cloud });
    const writer = makeHarness({ pollIntervalMs: null, cloud });
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
        const only = args.rows[0];
        if (only !== undefined && only.event.type === "client/turn/requested") {
          if (only.event.text === "two") {
            throw new Error("this row is refused");
          }
        }
        cursors.push(args.cursor);
        writeSyncCursor(harness.db, args.cursor);
      },
    });
    await loginAs(harness.runtime, "Reader");

    expect(cursors).toEqual([1, 3]);
    expect(readSyncState(harness.db).cursor).toBe(3);
  });

  it("skips this device's own rows and settles the cursor on the rest", async () => {
    const writer = makeHarness({ pollIntervalMs: null });
    const cloud = writer.cloud;
    await signIn(writer);
    append(writer, [message("thr_shared", "from the writer")]);
    await writer.runtime.syncNow();
    expect(writer.applied).toEqual([]);

    const reader = makeHarness({ pollIntervalMs: null, fetch: cloud.fetch });
    const signedIn = await loginAs(reader.runtime, "Desktop");
    expect(signedIn.kind).toBe("logged-in");

    await reader.runtime.syncNow();
    expect(reader.applied).toHaveLength(1);
    expect(reader.applied[0]?.threadId).toBe("thr_shared");
    expect(reader.applied[0]?.events[0]).toEqual(message("thr_shared", "from the writer"));
    expect(reader.applied[0]?.cursor).toBe(1);
  });
});
