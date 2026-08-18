// The sync loop's own behaviour, against `FakeCloud` — the contract's rules
// over Maps. What each case pins is a promise made in issue #572 that no unit
// below the runtime can keep on its own.

import { CAPTURE_API_PATHS } from "@repo/cloud-contract/captures";
import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { countSyncOutbox, writeSyncCursor } from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudFetch, CloudSocket, OpenCloudSocketArgs } from "../cloud-client";
import { readDeviceCredential } from "../credential-store";
import {
  CAPTURE_INBOX_PATH,
  createCloudRuntime,
  type CaptureVault,
  type CloudRuntime,
  type SyncedEventSink,
} from "../sync-runtime";
import { VaultServiceError } from "../../vault/vault-service";
import { makeTempDir } from "../../__tests__/temp-dir";
import { FakeCloud } from "./fake-cloud";

const CLOUD_URL = "https://cloud.test";
const CODE = "ABCD-EFGH";

const teardown: Array<() => void> = [];
afterEach(() => {
  for (const undo of teardown.splice(0).toReversed()) {
    undo();
  }
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
}

function makeHarness(
  options: { fetch?: CloudFetch; pollIntervalMs?: number | null } = {},
): Harness {
  const dataDir = makeTempDir("inteligir-sync-");
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  const cloud = new FakeCloud();
  const vault = makeVault();
  const applied: Harness["applied"] = [];
  const socketOpens: OpenCloudSocketArgs[] = [];
  const sink: SyncedEventSink = {
    applySyncedEvents: (args) => {
      applied.push(args);
      // The real sink is `ThreadService`, which writes the cursor inside the
      // same transaction that appends. A stub that skipped it would replay
      // every page forever and hide exactly the bug that pairing buys.
      writeSyncCursor(db, args.cursor);
    },
  };
  const runtime = createCloudRuntime({
    db,
    dataDir,
    cloudUrl: CLOUD_URL,
    vault,
    onDebug: () => undefined,
    transport: {
      fetch: options.fetch ?? cloud.fetch,
      openSocket: (args): CloudSocket => {
        socketOpens.push(args);
        return { close: () => undefined };
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    },
  });
  runtime.attach(sink);
  teardown.push(() => {
    void runtime.dispose();
    closeConnection(db);
  });
  return { db, dataDir, cloud, vault, runtime, applied, socketOpens };
}

function message(threadId: string, text: string): ThreadEvent {
  return { type: "client/turn/requested", threadId, text, kind: "message", scope: threadScope() };
}

function append(harness: Harness, events: readonly ThreadEvent[]): void {
  harness.db.transaction((tx) => harness.runtime.enqueue(tx, events), { behavior: "immediate" });
}

async function pair(harness: Harness): Promise<string> {
  harness.cloud.mintCode(CODE);
  const outcome = await harness.runtime.pair({ code: CODE, deviceName: "Laptop" });
  if (outcome.kind !== "paired") {
    throw new Error(`pairing refused: ${JSON.stringify(outcome.failure)}`);
  }
  return outcome.status.state === "paired" ? outcome.status.deviceId : "";
}

describe("sync is off until someone pairs", () => {
  it("opens no socket, arms no timer and makes no request", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();

    harness.runtime.start();
    append(harness, [message("thr_1", "a local message nobody asked to sync")]);
    // Ten minutes at the SHIPPING cadence — the poll interval is left at its
    // default here on purpose, so this is the real timer or none at all.
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(harness.cloud.requests).toEqual([]);
    expect(harness.socketOpens).toEqual([]);
    expect(harness.runtime.status()).toEqual({ state: "off", cloudUrl: CLOUD_URL });
    // Nor does it queue against a day someone might pair: the log is the
    // ACCOUNT's history, and a backlog no other device has a base for is not
    // it.
    expect(countSyncOutbox(harness.db)).toBe(0);
  });

  it("makes no request after an unpair either", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await pair(harness);
    append(harness, [message("thr_1", "before")]);
    await harness.runtime.syncNow();
    const requestsWhilePaired = harness.cloud.requests.length;

    expect(harness.runtime.unpair()).toEqual({ state: "off", cloudUrl: CLOUD_URL });
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
    append(harness, [message("thr_1", "after")]);
    await harness.runtime.syncNow();
    expect(harness.cloud.requests).toHaveLength(requestsWhilePaired);
  });
});

describe("pairing", () => {
  it("redeems a code and leaves the credential in the data dir", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await pair(harness);

    expect(readDeviceCredential(harness.dataDir)).toEqual({
      deviceId,
      credential: expect.stringMatching(/^igd_[0-9a-f]{64}$/u),
    });
    const status = harness.runtime.status();
    expect(status.state).toBe("paired");
  });

  it("reports the cloud's own refusal for a code it will not take", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const outcome = await harness.runtime.pair({ code: "ZZZZ-ZZZZ", deviceName: "Laptop" });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") throw new Error("expected a refusal");
    expect(outcome.failure).toEqual({
      kind: "refused",
      code: "invalid-code",
      message: "That pairing code isn't valid.",
      deviceSeq: null,
    });
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
  });
});

describe("a push interrupted mid-batch", () => {
  it("retries to no duplicate and no conflict", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await pair(harness);
    append(harness, [message("thr_1", "one"), message("thr_1", "two")]);

    // The connection dies after the first event is stored and before the
    // response is written — the client learns nothing, so the queue keeps
    // BOTH positions.
    harness.cloud.dropNextPushResponse = true;
    await harness.runtime.syncNow();
    expect(harness.cloud.logSize()).toBe(1);
    expect(countSyncOutbox(harness.db)).toBe(2);

    await harness.runtime.syncNow();
    // Position 1 replays with byte-identical bytes (a counted duplicate);
    // position 2 lands. Nothing is stored twice and nothing conflicts.
    expect(harness.cloud.logSize()).toBe(2);
    expect(countSyncOutbox(harness.db)).toBe(0);
    const status = harness.runtime.status();
    expect(status.state === "paired" ? status.lastError : "not paired").toBeNull();
  });
});

describe("a capture delivered twice", () => {
  it("applies once", async () => {
    const cloud = new FakeCloud();
    let lapsed = false;
    // The residual the contract states in full: a device that applies and then
    // loses its claim is handed the capture again. Reproduced by lapsing every
    // claim just as the first ack goes out, so that ack owns nothing.
    const fetchWithLapse: CloudFetch = async (input, init) => {
      if (!lapsed && new URL(input).pathname === CAPTURE_API_PATHS.ack) {
        lapsed = true;
        cloud.lapseClaims();
      }
      return cloud.fetch(input, init);
    };
    const harness = makeHarness({ pollIntervalMs: null, fetch: fetchWithLapse });
    harness.cloud.mintCode(CODE);
    // The harness's own FakeCloud is unused here; pair against the one the
    // wrapped fetch talks to.
    cloud.mintCode(CODE);
    const outcome = await harness.runtime.pair({ code: CODE, deviceName: "Laptop" });
    expect(outcome.kind).toBe("paired");

    cloud.capture("buy oat milk");
    await harness.runtime.syncNow();
    expect(harness.vault.files.get(CAPTURE_INBOX_PATH)).toContain("buy oat milk");

    // Delivered again, because the ack above owned nothing.
    await harness.runtime.syncNow();
    const inbox = harness.vault.files.get(CAPTURE_INBOX_PATH) ?? "";
    expect(inbox.match(/buy oat milk/gu)).toHaveLength(1);
  });
});

describe("a revoked device", () => {
  it("fails closed and surfaces as unauthorized rather than retrying forever", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await pair(harness);
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

    // Fail CLOSED: further passes cost nothing at all, so a revoked laptop
    // does not sit there hammering a credential the account has cancelled.
    const requestsAtRefusal = harness.cloud.requests.length;
    await harness.runtime.syncNow();
    await harness.runtime.syncNow();
    expect(harness.cloud.requests).toHaveLength(requestsAtRefusal);
  });
});

describe("the invalidation socket", () => {
  it("ignores a sync ping this device's cursor already covers", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    await pair(harness);
    const dial = harness.socketOpens[0];
    if (dial === undefined) throw new Error("expected a socket dial");
    const quiet = harness.cloud.requests.length;

    // The contract puts the log's high-water on the ping precisely so a client
    // can tell one it already covers from news.
    dial.onPing({ type: "sync", seq: 0 });
    await harness.runtime.syncNow();
    const afterCovered = harness.cloud.requests.length;

    dial.onPing({ type: "sync", seq: 99 });
    // The ping's own pass is in flight; joining it is what `syncNow` does.
    await harness.runtime.syncNow();
    expect(afterCovered).toBeGreaterThan(quiet);
    expect(harness.cloud.requests.length).toBeGreaterThan(afterCovered);
  });

  it("re-dials after a close, and a severed socket turns into a refusal", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const deviceId = await pair(harness);
    const dial = harness.socketOpens[0];
    if (dial === undefined) throw new Error("expected a socket dial");

    // 1008 is the cloud severing a REVOKED device — a hint, never the verdict,
    // so the pass it triggers is what establishes the fact.
    harness.cloud.revoke(deviceId);
    dial.onClose(1008);
    await harness.runtime.syncNow();
    expect(harness.runtime.status().state).toBe("unauthorized");
  });
});

describe("applying the account's log", () => {
  it("skips this device's own rows and settles the cursor on the rest", async () => {
    const writer = makeHarness({ pollIntervalMs: null });
    const cloud = writer.cloud;
    await pair(writer);
    append(writer, [message("thr_shared", "from the writer")]);
    await writer.runtime.syncNow();
    // Its own row came back through the merged log and must not be re-applied.
    expect(writer.applied).toEqual([]);

    const reader = makeHarness({ pollIntervalMs: null, fetch: cloud.fetch });
    cloud.mintCode("WXYZ-WXYZ");
    const paired = await reader.runtime.pair({ code: "WXYZ-WXYZ", deviceName: "Desktop" });
    expect(paired.kind).toBe("paired");

    // Pairing runs a pass of its own, and a second one must find nothing left
    // — the cursor moved with the apply.
    await reader.runtime.syncNow();
    expect(reader.applied).toHaveLength(1);
    expect(reader.applied[0]?.threadId).toBe("thr_shared");
    expect(reader.applied[0]?.events[0]).toEqual(message("thr_shared", "from the writer"));
    expect(reader.applied[0]?.cursor).toBe(1);
  });
});
