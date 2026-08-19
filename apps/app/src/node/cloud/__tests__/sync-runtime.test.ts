// The sync loop's own behaviour, against `FakeCloud` — the contract's rules
// over Maps. What each case pins is a promise made in issue #572 that no unit
// below the runtime can keep on its own.

import { CAPTURE_API_PATHS } from "@repo/cloud-contract/captures";
import { SYNC_API_PATHS } from "@repo/cloud-contract/sync";
import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { countSyncOutbox, readSyncState, writeSyncCursor } from "@repo/db/sync-outbox";
import type { CloudPairBeginResponse } from "@repo/server-contract/cloud";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_INBOX_PATH, type CaptureVault } from "../captures";
import type { CloudFetch, CloudSocket, OpenCloudSocketArgs } from "../cloud-client";
import { readDeviceCredential } from "../credential-store";
import {
  createCloudRuntime,
  type CloudRuntime,
  type PairCompletion,
  type SyncedEventSink,
} from "../sync-runtime";
import { VaultServiceError } from "../../vault/vault-service";
import { makeTempDir } from "../../__tests__/temp-dir";
import { FakeCloud } from "./fake-cloud";

const CLOUD_URL = "https://cloud.test";
const CODE = "ABCD-EFGH";
/** Where this app would send the browser back to. The port is arbitrary — what
 *  matters is that it is a shape `pairRedirectUrlSchema` admits. */
const CALLBACK_URL = "http://127.0.0.1:4664/pair/callback";

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
  /** Every URL this runtime asked the desktop to open. */
  opened: string[];
}

function makeHarness(
  options: {
    fetch?: CloudFetch;
    pollIntervalMs?: number | null;
    /** Share one cloud between harnesses, or between a harness and a fetch
     *  wrapper that gates it. */
    cloud?: FakeCloud;
    /** What the injected opener answers — false is the headless machine. */
    canOpenBrowser?: boolean;
  } = {},
): Harness {
  const dataDir = makeTempDir("inteligir-sync-");
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  const cloud = options.cloud ?? new FakeCloud();
  const vault = makeVault();
  const applied: Harness["applied"] = [];
  const socketOpens: OpenCloudSocketArgs[] = [];
  const opened: string[] = [];
  const sink: SyncedEventSink = {
    applySyncedEvents: (args) => {
      applied.push({
        threadId: args.threadId,
        events: args.rows.map((row) => row.event),
        cursor: args.cursor,
      });
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
    openExternalUrl: async (url) => {
      opened.push(url);
      return options.canOpenBrowser ?? true;
    },
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
  return { db, dataDir, cloud, vault, runtime, applied, socketOpens, opened };
}

function message(threadId: string, text: string): ThreadEvent {
  return { type: "client/turn/requested", threadId, text, kind: "message", scope: threadScope() };
}

function append(harness: Harness, events: readonly ThreadEvent[]): void {
  harness.db.transaction((tx) => harness.runtime.enqueue(tx, events), { behavior: "immediate" });
}

/** The approve page's act: mint the code BOUND to the PKCE challenge `beginPair`
 *  put on the URL, and hand back the `state` the callback carries. Registered
 *  after begin because the challenge only exists then — the app kept the
 *  verifier, the browser only ever saw the hash. */
function approve(cloud: FakeCloud, begun: CloudPairBeginResponse, code: string): string {
  const url = new URL(begun.url);
  cloud.mintCode(code, url.searchParams.get("challenge") ?? "");
  return url.searchParams.get("state") ?? "";
}

async function pairWithCode(
  runtime: CloudRuntime,
  cloud: FakeCloud,
  code: string,
  deviceName: string,
): Promise<PairCompletion> {
  const begun = await runtime.beginPair({
    callbackUrl: CALLBACK_URL,
    deviceName,
    openBrowser: false,
  });
  const state = approve(cloud, begun, code);
  return await runtime.completePair({ code, state });
}

async function pair(harness: Harness): Promise<string> {
  const outcome = await pairWithCode(harness.runtime, harness.cloud, CODE, "Laptop");
  if (outcome.kind !== "paired") {
    throw new Error(`pairing refused: ${JSON.stringify(outcome)}`);
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
    // No approve(): the code is never registered, so the cloud refuses it — the
    // ordinary invalid-code path, unrelated to PKCE.
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const state = new URL(begun.url).searchParams.get("state") ?? "";
    const outcome = await harness.runtime.completePair({ code: "ZZZZ-ZZZZ", state });
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

// The state is what binds a callback to a request THIS app made. Every way it
// can fail to bind is a way a loopback route reachable by any local page turns
// into a pairing nobody asked for, so each one is pinned.
describe("the pending approval", () => {
  it("puts the callback, the state and the device name on the approve URL", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      deviceName: "Work laptop",
      openBrowser: true,
    });

    const url = new URL(begun.url);
    expect(url.origin).toBe(CLOUD_URL);
    expect(url.pathname).toBe("/app/pair");
    expect(url.searchParams.get("redirect")).toBe(CALLBACK_URL);
    expect(url.searchParams.get("name")).toBe("Work laptop");
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/u);
    expect(begun).toMatchObject({ opened: true, deviceName: "Work laptop" });
    // The SERVER opens it — same act from a browser tab, the shell or the CLI.
    expect(harness.opened).toEqual([begun.url]);
  });

  it("opens nothing when the caller did not ask, and still answers the URL", async () => {
    // The agent's path: a browser window nobody asked for is the failure.
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    expect(harness.opened).toEqual([]);
    expect(begun.opened).toBe(false);
    expect(begun.url.length).toBeGreaterThan(0);
  });

  it("reports a failed open rather than claiming one", async () => {
    const harness = makeHarness({ pollIntervalMs: null, canOpenBrowser: false });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: true,
    });
    expect(begun.opened).toBe(false);
  });

  it("is CONSUMED by the callback it completes, so a replay applies nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      deviceName: "Laptop",
      openBrowser: false,
    });
    const state = approve(harness.cloud, begun, CODE);

    expect((await harness.runtime.completePair({ code: CODE, state })).kind).toBe("paired");
    const credential = readDeviceCredential(harness.dataDir);
    expect(credential).not.toBeNull();

    // The same URL out of a browser history: the state was consumed, so this
    // is no-pending before any redeem — no second credential.
    const replayed = await harness.runtime.completePair({ code: CODE, state });
    expect(replayed.kind).toBe("no-pending");
    expect(readDeviceCredential(harness.dataDir)).toEqual(credential);
  });

  it("is inert with nothing armed — any local page can reach this route", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const outcome = await harness.runtime.completePair({ code: CODE, state: "0".repeat(32) });
    expect(outcome.kind).toBe("no-pending");
    expect(harness.cloud.requests).toEqual([]);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
  });

  it("refuses a wrong state WITHOUT spending the approval it does not match", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const state = approve(harness.cloud, begun, CODE);

    expect((await harness.runtime.completePair({ code: CODE, state: "f".repeat(32) })).kind).toBe(
      "state-mismatch",
    );
    expect(harness.cloud.requests).toEqual([]);
    // Otherwise any local page could cancel a pairing the user is halfway
    // through, just by guessing wrong.
    expect((await harness.runtime.completePair({ code: CODE, state })).kind).toBe("paired");
  });

  it("expires, and redeems nothing once it has", async () => {
    vi.useFakeTimers();
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const state = approve(harness.cloud, begun, CODE);

    vi.setSystemTime(Date.now() + begun.expiresInMs + 1);
    expect((await harness.runtime.completePair({ code: CODE, state })).kind).toBe("expired");
    expect(harness.cloud.requests).toEqual([]);
    expect(readDeviceCredential(harness.dataDir)).toBeNull();
  });

  it("keeps ONE slot: a second begin is the button pressed again", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const first = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const stale = new URL(first.url).searchParams.get("state") ?? "";
    const second = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const live = approve(harness.cloud, second, CODE);
    expect(stale).not.toBe(live);

    expect((await harness.runtime.completePair({ code: CODE, state: stale })).kind).toBe(
      "state-mismatch",
    );
    expect((await harness.runtime.completePair({ code: CODE, state: live })).kind).toBe("paired");
  });

  it("is dropped by an unpair — that button said stop", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const state = approve(harness.cloud, begun, CODE);
    harness.runtime.unpair();
    expect((await harness.runtime.completePair({ code: CODE, state })).kind).toBe("no-pending");
  });

  it("is inert after dispose — a callback in flight during shutdown redeems nothing", async () => {
    const harness = makeHarness({ pollIntervalMs: null });
    const begun = await harness.runtime.beginPair({
      callbackUrl: CALLBACK_URL,
      openBrowser: false,
    });
    const state = approve(harness.cloud, begun, CODE);

    await harness.runtime.dispose();
    const outcome = await harness.runtime.completePair({ code: CODE, state });

    // No redeem over the network, and no credential written after teardown.
    expect(outcome.kind).toBe("no-pending");
    expect(harness.cloud.requests).toEqual([]);
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
    // The harness's own FakeCloud is unused here; pair against the one the
    // wrapped fetch talks to, so the challenge binds where the redeem lands.
    const outcome = await pairWithCode(harness.runtime, cloud, CODE, "Laptop");
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

/**
 * A fetch that HOLDS the first call to one path until the test lets it go, so
 * a pair, an unpair or a dispose can land in the middle of a pass. It honours
 * the abort signal the client attaches, which is what a real request does and
 * what makes the cancellation assertions mean anything.
 */
interface Gate {
  fetch: CloudFetch;
  /** Inert until this is called, so a pairing's own pass runs through. */
  arm: () => void;
  reached: Promise<void>;
  release: () => void;
}

/**
 * WHERE the gate holds, and why both places are needed.
 *
 * `before` holds the request itself — the in-flight case, which cancellation
 * is supposed to cut short.
 *
 * `after` lets the request COMPLETE and holds the response on the doorstep.
 * That is the window cancellation cannot reach: the call already succeeded, so
 * aborting is a no-op, and the only thing standing between an old session's
 * answer and a write into the new one is the identity check.
 */
type GateWhen = "before" | "after";

/** Only ever the placeholder a `new Promise` executor overwrites. */
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
      // In flight, so cancellable — the abort must cut it short.
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
    // Completed, so NOT cancellable: a real fetch's promise is already
    // resolved at this point and no abort can un-resolve it. Racing the signal
    // here would model a window that does not exist and would hide the very
    // thing this mode is for.
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

/** Wait for a re-pairing to have taken, from OUTSIDE the `pair` call this test
 *  has deliberately not awaited. */
async function waitForPairing(runtime: CloudRuntime, deviceId: string): Promise<void> {
  await vi.waitFor(() => {
    const status = runtime.status();
    expect(status.state === "paired" ? status.deviceId : null).toBe(deviceId);
  });
}

describe("a session that changes mid-pass", () => {
  it("does not let a finished session's ack delete the next one's queue", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, SYNC_API_PATHS.push, "after");
    const harness = makeHarness({ pollIntervalMs: null, fetch: gate.fetch, cloud });
    await pairWithCode(harness.runtime, cloud, CODE, "Laptop");
    append(harness, [message("thr_1", "belongs to the first pairing")]);

    gate.arm();
    const pass = harness.runtime.syncNow();
    // The push SUCCEEDED and its response is on the doorstep. The ack — which
    // DELETES rows — has not run yet.
    await gate.reached;

    // RE-PAIR, not unpair: the session stays `live`, so "is a session running?"
    // still answers yes and only the session's IDENTITY can tell the two apart.
    // Not awaited — the pass this test is holding is what `pair` itself waits
    // for once it gets that far.
    const repaired = pairWithCode(harness.runtime, cloud, "WXYZ-WXYZ", "Laptop again");
    await waitForPairing(harness.runtime, "dev_2");

    // The new pairing's own work. The counter reset with it, so this row
    // carries the very position the held push is about to acknowledge.
    append(harness, [message("thr_1", "belongs to the second pairing")]);

    gate.release();
    await repaired;
    await pass;

    // The second pairing's event REACHED the log. A stale ack would have
    // deleted it from the queue before anyone pushed it, and it would be gone
    // with no error anywhere.
    expect(cloud.logSize()).toBe(2);
    expect(countSyncOutbox(harness.db)).toBe(0);
  });

  it("does not apply one account's page into a pairing with another", async () => {
    // TWO accounts, because that is what makes a wrongly-applied page visible:
    // the same account's rows are idempotent by origin, so applying them late
    // is merely wasteful. Another account's rows are somebody else's
    // conversation landing in this vault.
    const leaving = makeHarness({ pollIntervalMs: null });
    await pair(leaving);
    append(leaving, [message("thr_leaving", "from the account being left")]);
    await leaving.runtime.syncNow();

    const joining = makeHarness({ pollIntervalMs: null });
    await pair(joining);
    append(joining, [message("thr_joining", "from the account being joined")]);
    await joining.runtime.syncNow();

    // The reader's transport follows whichever account it is paired to, which
    // is what a re-pair against a different deployment actually looks like.
    let current = leaving.cloud;
    const gate = gatedFetch(leaving.cloud, SYNC_API_PATHS.pull, "after");
    const reader = makeHarness({
      pollIntervalMs: null,
      cloud: leaving.cloud,
      fetch: (input, init) =>
        current === leaving.cloud ? gate.fetch(input, init) : current.fetch(input, init),
    });
    await pairWithCode(reader.runtime, leaving.cloud, "READ-ONCE", "Reader");

    // A row the gated page will carry.
    append(leaving, [message("thr_leaving", "the page held mid-flight")]);
    await leaving.runtime.syncNow();
    reader.applied.length = 0;
    gate.arm();
    const pass = reader.runtime.syncNow();
    await gate.reached;

    // The page ARRIVED. Now the device joins a different account — `live`
    // throughout, so identity is the only thing that can refuse the page.
    current = joining.cloud;
    const repaired = pairWithCode(reader.runtime, joining.cloud, "JOIN-NOW", "Reader elsewhere");
    // NOT waitForPairing on the deviceId here — the reader was already "dev_2"
    // on leaving.cloud, so that would resolve before the re-pair's session swap
    // even ran. Wait instead for the re-pair's redeem to LAND on joining.cloud
    // (its second device, after the joining install), which only happens once
    // completePair is past its redeem and into openSession.
    await vi.waitFor(() => expect(joining.cloud.deviceCount()).toBe(2));
    // Let the redeem's microtask continuation (openSession) drain before the
    // held page is released, so the fence sees the new session.
    await Promise.resolve();
    reader.applied.length = 0;

    gate.release();
    await repaired;
    await pass;

    // Whatever landed came from the account this device is actually paired to.
    expect(reader.applied.length).toBeGreaterThan(0);
    expect(reader.applied.map((entry) => entry.threadId)).not.toContain("thr_leaving");
  });
});

describe("dispose", () => {
  it("cancels the pass rather than waiting it out", async () => {
    const cloud = new FakeCloud();
    const gate = gatedFetch(cloud, SYNC_API_PATHS.pull);
    const harness = makeHarness({ pollIntervalMs: null, fetch: gate.fetch, cloud });
    await pairWithCode(harness.runtime, cloud, CODE, "Laptop");
    cloud.capture("something the inbox is holding");

    gate.arm();
    const pass = harness.runtime.syncNow();
    await gate.reached;
    const requestsAtDispose = cloud.requests.length;

    await harness.runtime.dispose();
    gate.release();
    await pass;

    // Nothing after the teardown: no claim, no ack, and no vault write. The
    // step's budget is only a bound if the pass observes cancellation.
    expect(cloud.requests.slice(requestsAtDispose)).toEqual([]);
    expect(harness.vault.files.get(CAPTURE_INBOX_PATH)).toBeUndefined();
  });
});

describe("every cloud call carries a deadline", () => {
  it("attaches a signal to every request, redeem included", async () => {
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
    await pair(harness);
    append(harness, [message("thr_1", "so the push happens too")]);
    await harness.runtime.syncNow();

    // Every route this client speaks, and no exceptions: one black-holed
    // request holds the single-flight pass, and every other trigger coalesces
    // onto it — so a call with no deadline stalls the whole loop, not itself.
    expect(signalled.length).toBeGreaterThan(4);
    expect(signalled.filter((call) => !call.hasSignal)).toEqual([]);
  });
});

describe("applying the account's log", () => {
  it("commits each retried row's OWN position, never the group's", async () => {
    const cloud = new FakeCloud();
    const harness = makeHarness({ pollIntervalMs: null, cloud });
    // A writer whose rows this reader will pull.
    const writer = makeHarness({ pollIntervalMs: null, cloud });
    await pair(writer);
    append(writer, [message("thr_1", "one"), message("thr_1", "two"), message("thr_1", "three")]);
    await writer.runtime.syncNow();

    // A sink that refuses any GROUP, forcing the per-row retry, and refuses one
    // row outright — the shape a turn-content event with no stored
    // `turn/started` produces.
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
    await pairWithCode(harness.runtime, cloud, "READ-ONCE", "Reader");

    // Three distinct positions, each committed by the row it belongs to.
    // Handing every retry the group's last seq would record rows 2 and 3 as
    // seen the instant row 1 committed.
    expect(cursors).toEqual([1, 3]);
    expect(readSyncState(harness.db).cursor).toBe(3);
  });

  it("skips this device's own rows and settles the cursor on the rest", async () => {
    const writer = makeHarness({ pollIntervalMs: null });
    const cloud = writer.cloud;
    await pair(writer);
    append(writer, [message("thr_shared", "from the writer")]);
    await writer.runtime.syncNow();
    // Its own row came back through the merged log and must not be re-applied.
    expect(writer.applied).toEqual([]);

    const reader = makeHarness({ pollIntervalMs: null, fetch: cloud.fetch });
    const paired = await pairWithCode(reader.runtime, cloud, "WXYZ-WXYZ", "Desktop");
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
