// The RN sync loop: carry this device's queued thread events to the account's
// merged log, and apply everyone else's back into the store the UI reads. The
// node twin is apps/app/src/node/cloud/sync-runtime.ts; this is the same wire and
// the same disciplines over React Native storage.
//
// THE CREDENTIAL IS THE SWITCH. With none, this object opens no timer and makes
// no request; the pairing layer sets it, and `setCredential(null)` (unpair)
// clears the account's state. There is no second "enabled" flag, for the reason
// the desktop states: two values that must agree are two that can disagree.
//
// ONE DIRECTION AT A TIME, in one single-flight pass: drain the outbox, then
// page the log forward. A trigger that lands mid-pass marks the pass dirty rather
// than starting a second one — two concurrent drains would push a batch twice,
// two concurrent pulls would apply a page twice.
//
// EVERY STEP RE-CHECKS THE SESSION ID after every await. "Is a session live?" is
// the wrong question when the answer can be yes about a DIFFERENT pairing: an old
// push's ack would delete rows a re-pair has since queued, an old pull's page
// would apply another account's events. The id is the fence; cancellation covers
// the in-flight half, identity the half cancellation cannot reach.
//
// Captures are NOT claimed here — see captures.ts and the README. The default
// runtime produces captures (quick-capture) and reads threads; the desktop owns
// applying captures to the vault.

import type { CaptureRequest, CaptureResponse } from "@repo/cloud-contract/captures";
import type { CloudErrorCode } from "@repo/cloud-contract/errors";
import { PULL_DEFAULT_LIMIT } from "@repo/cloud-contract/sync";
import type { ThreadEvent } from "@repo/domain/provider-event";
import {
  createCloudClient,
  describeCloudFailure,
  type CloudClient,
  type CloudFailure,
  type CloudFetch,
  type CloudResult,
} from "./cloud-client";
import { ackPushBatch, enqueueThreadEvents, takePushBatch } from "./outbox";
import { applyPlan, planPage } from "./thread-log";
import type { SyncStore } from "./sync-store";
import type { DeviceCredential } from "../credential/credential-codec";

export type SyncStatus =
  | { state: "off" }
  | { state: "unauthorized"; deviceId: string; detail: string }
  | {
      state: "paired";
      deviceId: string;
      pending: number;
      cursor: number;
      lastSyncedAt: number | null;
      lastError: string | null;
    };

/** The fallback cadence, deliberately slow — a device with no live socket is at
 *  most one interval behind. (The invalidation socket is a later round; until it
 *  lands the poll is what makes sync correct.) */
const POLL_INTERVAL_MS = 60_000;

/** Bound on one pass's drain and pull, so a backlog cannot starve the other half
 *  or hold a teardown open. What is left rides the next pass. */
const MAX_PUSH_BATCHES_PER_PASS = 25;
const MAX_PULL_PAGES_PER_PASS = 25;

/** Refusals that end this device's session — both terminal: `unauthorized` is a
 *  revoked or unknown credential, `account-deleted` a tombstoned account. */
const TERMINAL_CODES: ReadonlySet<CloudErrorCode> = new Set(["unauthorized", "account-deleted"]);
/** Refusals that mean THIS DEVICE'S OWN OUTBOX disagrees with the log. */
const OUTBOX_CODES: ReadonlySet<CloudErrorCode> = new Set(["sync-conflict", "sync-out-of-order"]);

type Session =
  | { kind: "off"; id: number }
  | { kind: "live"; id: number; credential: DeviceCredential; client: CloudClient }
  | { kind: "unauthorized"; id: number; credential: DeviceCredential; detail: string };

/** What one pass runs under, captured once at the top so no step reads a newer
 *  session. */
interface PassContext {
  sessionId: number;
  client: CloudClient;
  deviceId: string;
}

export interface SyncRuntimeArgs {
  store: SyncStore;
  cloudUrl: string;
  fetch?: CloudFetch;
  /** How the authed client is built for a credential. Injected so the suite can
   *  drive the whole loop with a fake client; production builds the real one
   *  over `fetch`. */
  createClient?: (credential: DeviceCredential) => CloudClient;
  /** null disables the poll timer — what a deterministic suite needs. */
  pollIntervalMs?: number | null;
  now?: () => number;
  onDebug?: (message: string) => void;
}

export interface SyncRuntime {
  status(): SyncStatus;
  /** Pair / re-pair / unpair. A different credential resets the store, because it
   *  describes an account this device may no longer be talking to. */
  setCredential(next: DeviceCredential | null): void;
  /** Queue this device's own events for the log — the hook a future dispatch
   *  push calls. A no-op while unpaired. */
  enqueue(events: readonly ThreadEvent[]): void;
  /** POST a quick capture over the live credential — the producer half of the
   *  inbox. Refused (unreachable) while unpaired. */
  createCapture(request: CaptureRequest): Promise<CloudResult<CaptureResponse>>;
  start(): void;
  syncNow(): Promise<SyncStatus>;
  dispose(): Promise<void>;
}

function sameCredential(a: DeviceCredential, b: DeviceCredential): boolean {
  return a.deviceId === b.deviceId && a.credential === b.credential;
}

export function createSyncRuntime(args: SyncRuntimeArgs): SyncRuntime {
  const now = args.now ?? Date.now;
  const debug = args.onDebug ?? ((message: string) => console.warn(`sync: ${message}`));
  const pollIntervalMs = args.pollIntervalMs === undefined ? POLL_INTERVAL_MS : args.pollIntervalMs;

  let sessionCounter = 0;
  let session: Session = { kind: "off", id: 0 };
  let sessionAbort = new AbortController();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;
  let dirty = false;
  let lastError: string | null = null;
  let lastSyncedAt: number | null = null;
  let disposed = false;

  function closeSession(): void {
    sessionAbort.abort();
    sessionAbort = new AbortController();
  }

  function makeClient(credential: DeviceCredential): CloudClient {
    if (args.createClient !== undefined) return args.createClient(credential);
    const clientArgs: Parameters<typeof createCloudClient>[0] = {
      baseUrl: args.cloudUrl,
      credential: credential.credential,
      signal: sessionAbort.signal,
    };
    if (args.fetch !== undefined) clientArgs.fetch = args.fetch;
    return createCloudClient(clientArgs);
  }

  function openSession(credential: DeviceCredential): void {
    closeSession();
    sessionCounter += 1;
    session = { kind: "live", id: sessionCounter, credential, client: makeClient(credential) };
  }

  function clearTimer(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function armTimer(): void {
    if (disposed || session.kind !== "live" || pollIntervalMs === null || pollTimer !== null)
      return;
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  function fenced(context: PassContext): boolean {
    return !disposed && session.kind === "live" && session.id === context.sessionId;
  }

  /** True when the failure ends this device's session; the caller stops. */
  function recordFailure(failure: CloudFailure): boolean {
    lastError = describeCloudFailure(failure);
    if (failure.kind !== "refused" || !TERMINAL_CODES.has(failure.code)) {
      debug(lastError);
      return false;
    }
    if (session.kind === "live") {
      sessionCounter += 1;
      session = {
        kind: "unauthorized",
        id: sessionCounter,
        credential: session.credential,
        detail: failure.message,
      };
    }
    closeSession();
    clearTimer();
    debug(`credential refused (${failure.code}): ${failure.message}`);
    return true;
  }

  /** Drain the outbox. Returns false when the session ended. An outbox refusal is
   *  not retried — the log holds a body at that position or one past it, so the
   *  queued row can never land where it is numbered, and keeping it wedges every
   *  event behind it. */
  async function drain(context: PassContext): Promise<boolean> {
    for (let round = 0; round < MAX_PUSH_BATCHES_PER_PASS; round += 1) {
      if (!fenced(context)) return false;
      const batch = takePushBatch(args.store);
      if (batch === null) return true;
      for (const row of batch.rejected) {
        debug(`dropping outbox position ${row.deviceSeq}: ${row.reason}`);
      }
      if (batch.request.events.length === 0) {
        ackPushBatch(args.store, batch);
        continue;
      }
      const result = await context.client.push(batch.request);
      // The ack DELETES rows — a pair or unpair that landed while this was in
      // flight has already emptied that queue.
      if (!fenced(context)) return false;
      if (!result.ok) {
        if (result.failure.kind === "refused" && OUTBOX_CODES.has(result.failure.code)) {
          const through = result.failure.deviceSeq ?? batch.throughDeviceSeq;
          const dropped = args.store.deleteOutboxThrough(through);
          debug(
            `${result.failure.code} at position ${through}: dropped ${dropped} queued event(s) the log will not take`,
          );
          lastError = describeCloudFailure(result.failure);
          continue;
        }
        return !recordFailure(result.failure);
      }
      ackPushBatch(args.store, batch);
      lastError = null;
    }
    return true;
  }

  /** Page the log forward and apply everything this device did not write. Returns
   *  false when the session ended. */
  async function pullAndApply(context: PassContext): Promise<boolean> {
    for (let page = 0; page < MAX_PULL_PAGES_PER_PASS; page += 1) {
      if (!fenced(context)) return false;
      const cursor = args.store.readCursor();
      const result = await context.client.pull({ afterSeq: cursor, limit: PULL_DEFAULT_LIMIT });
      // This page belongs to the account this pass started under. Applying it
      // after a re-pair would write another account's events into this one.
      if (!fenced(context)) return false;
      if (!result.ok) return !recordFailure(result.failure);
      lastError = null;
      const plan = planPage(result.value.events, context.deviceId);
      for (const message of plan.skipped) debug(message);
      applyPlan(args.store, plan.steps);
      if (!result.value.hasMore) return true;
    }
    return true;
  }

  async function runPass(): Promise<void> {
    if (session.kind !== "live" || disposed) return;
    const context: PassContext = {
      sessionId: session.id,
      client: session.client,
      deviceId: session.credential.deviceId,
    };
    if (!(await drain(context))) return;
    if (!(await pullAndApply(context))) return;
    if (!fenced(context)) return;
    lastSyncedAt = now();
  }

  async function syncNow(): Promise<SyncStatus> {
    if (session.kind !== "live" || disposed) return status();
    if (inflight !== null) {
      // Coalesced rather than queued: one more pass after this covers whatever
      // arrived while it ran.
      dirty = true;
      await inflight;
      return status();
    }
    inflight = (async () => {
      try {
        for (;;) {
          dirty = false;
          await runPass();
          if (!dirty || disposed || session.kind !== "live") break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        debug(`sync pass failed: ${lastError}`);
      } finally {
        inflight = null;
      }
    })();
    await inflight;
    return status();
  }

  function status(): SyncStatus {
    switch (session.kind) {
      case "off":
        return { state: "off" };
      case "unauthorized":
        return {
          state: "unauthorized",
          deviceId: session.credential.deviceId,
          detail: session.detail,
        };
      case "live":
        return {
          state: "paired",
          deviceId: session.credential.deviceId,
          pending: args.store.countOutbox(),
          cursor: args.store.readCursor(),
          lastSyncedAt,
          lastError,
        };
    }
  }

  return {
    status,

    setCredential(next) {
      if (next !== null && session.kind === "live" && sameCredential(next, session.credential)) {
        return;
      }
      closeSession();
      clearTimer();
      // A fresh pairing starts from a clean slate: the outbox and the cursor
      // describe an account this device may no longer be talking to.
      args.store.reset();
      lastError = null;
      lastSyncedAt = null;
      if (next === null) {
        sessionCounter += 1;
        session = { kind: "off", id: sessionCounter };
        return;
      }
      openSession(next);
    },

    enqueue(events) {
      if (session.kind !== "live" || events.length === 0) return;
      enqueueThreadEvents(args.store, events, now());
    },

    createCapture(request) {
      if (session.kind !== "live") {
        return Promise.resolve({
          ok: false,
          failure: { kind: "unreachable", message: "not paired" },
        });
      }
      return session.client.createCapture(request);
    },

    start() {
      if (session.kind !== "live") return;
      armTimer();
      void syncNow();
    },

    syncNow,

    async dispose() {
      disposed = true;
      clearTimer();
      // Cancels the requests in flight, so the teardown does not wait out every
      // remaining round trip.
      sessionAbort.abort();
      await inflight?.catch(() => undefined);
    },
  };
}
