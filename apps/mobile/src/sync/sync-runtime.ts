// The RN sync loop: page the account's merged thread log forward and apply into
// the store the UI reads. The node twin is apps/cli/src/server/cloud/sync-runtime.ts;
// this is the same wire and the same disciplines over React Native storage.
//
// THE PHONE ONLY PULLS THREADS. The desktop runs the turns, so this device
// produces no thread event and pushes none — the outbox half of the wire is the
// desktop's alone.
//
// CAPTURES ARE PRODUCED HERE AND CLAIMED ELSEWHERE. `createCapture` POSTs a
// quick capture to `/v1/capture` with a client-minted idempotency key, so a
// share-sheet retry after a lost response is one row and not two. The desktop
// owns applying a capture to the vault; a phone claiming would take a capture
// the desktop then never sees.
//
// THE CREDENTIAL IS THE SWITCH. With none, this object opens no timer and makes
// no request; the pairing layer sets it, and `setCredential(null)` (unpair)
// clears the account's state. There is no second "enabled" flag, for the reason
// the desktop states: two values that must agree are two that can disagree.
//
// A PASS IS SINGLE-FLIGHT AND COALESCING. A trigger that lands mid-pass marks
// the pass dirty rather than starting a second one — two concurrent pulls would
// apply the same page twice.
//
// EVERY STEP RE-CHECKS THE SESSION ID after every await. "Is a session live?" is
// the wrong question when the answer can be yes about a DIFFERENT pairing: an
// old pull's page would apply another account's events. The id is the fence;
// cancellation covers the in-flight half, identity the half cancellation cannot
// reach.
//
// THE STATUS IS PUBLISHED, NOT POLLED. Most passes run off the timer with no
// caller to read their answer, so the runtime itself is the store the screen
// subscribes to: the snapshot is rebuilt at every point the session, a pass or
// the cursor moves, and cached between them — `useSyncExternalStore` treats a
// fresh reference as new state, so a snapshot built per read is an infinite
// render loop.

import type { CaptureRequest, CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import { SYNC_TERMINAL_CODES } from "@repo/api/cloud/errors";
import { planPage } from "@repo/api/cloud/sync/plan-page";
import { PULL_DEFAULT_LIMIT } from "@repo/api/cloud/sync/sync-schema";
import {
  createCloudClient,
  describeCloudFailure,
  type CloudClient,
  type CloudFailure,
  type CloudResult,
} from "@repo/api/cloud/client";
import { createExternalStore, type ReadableStore } from "../lib/external-store";
import { applyPlan } from "./thread-log";
import type { SyncStore } from "./sync-store";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";

export type SyncStatus =
  | { state: "off" }
  | { state: "unauthorized"; deviceId: string; detail: string }
  | {
      state: "paired";
      deviceId: string;
      cursor: number;
      lastSyncedAt: number | null;
      lastError: string | null;
    };

/** The fallback cadence, deliberately slow — a device with no live socket is at
 *  most one interval behind. (The invalidation socket is a later round; until it
 *  lands the poll is what makes sync correct.) */
const POLL_INTERVAL_MS = 60_000;

/** Bound on one pass's pull, so a backlog cannot hold a teardown open. What is
 *  left rides the next pass. */
const MAX_PULL_PAGES_PER_PASS = 25;

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
  /** How the authed client is built for a credential. Injected so the suite can
   *  drive the whole loop with a fake client; production builds the real one
   *  over `fetch`. */
  createClient?: (credential: DeviceCredential) => CloudClient;
  /** null disables the poll timer — what a deterministic suite needs. */
  pollIntervalMs?: number | null;
}

export interface SyncRuntime extends ReadableStore<SyncStatus> {
  /** Pair / re-pair / unpair. A different credential resets the store, because it
   *  describes an account this device may no longer be talking to. */
  setCredential(next: DeviceCredential | null): void;
  /** POST a quick capture over the live credential — the producer half of the
   *  inbox. Refused (unreachable) while unpaired. */
  createCapture(request: CaptureRequest): Promise<CloudResult<CaptureResponse>>;
  start(): void;
  syncNow(): Promise<void>;
}

function sameCredential(a: DeviceCredential, b: DeviceCredential): boolean {
  return a.deviceId === b.deviceId && a.credential === b.credential;
}

function debug(message: string): void {
  console.warn(`sync: ${message}`);
}

export function createSyncRuntime(args: SyncRuntimeArgs): SyncRuntime {
  const pollIntervalMs = args.pollIntervalMs === undefined ? POLL_INTERVAL_MS : args.pollIntervalMs;

  let sessionCounter = 0;
  let session: Session = { kind: "off", id: 0 };
  let sessionAbort = new AbortController();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;
  let dirty = false;
  let lastError: string | null = null;
  let lastSyncedAt: number | null = null;
  const status = createExternalStore<SyncStatus>({ state: "off" });

  function publish(): void {
    switch (session.kind) {
      case "off":
        status.set({ state: "off" });
        return;
      case "unauthorized":
        status.set({
          state: "unauthorized",
          deviceId: session.credential.deviceId,
          detail: session.detail,
        });
        return;
      case "live":
        status.set({
          state: "paired",
          deviceId: session.credential.deviceId,
          cursor: args.store.readCursor(),
          lastSyncedAt,
          lastError,
        });
    }
  }

  function closeSession(): void {
    sessionAbort.abort();
    sessionAbort = new AbortController();
  }

  function makeClient(credential: DeviceCredential): CloudClient {
    if (args.createClient !== undefined) return args.createClient(credential);
    return createCloudClient({
      baseUrl: args.cloudUrl,
      credential: credential.credential,
      signal: sessionAbort.signal,
    });
  }

  function openSession(credential: DeviceCredential): void {
    closeSession();
    sessionCounter += 1;
    session = { kind: "live", id: sessionCounter, credential, client: makeClient(credential) };
    publish();
  }

  function clearTimer(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function armTimer(): void {
    if (session.kind !== "live" || pollIntervalMs === null || pollTimer !== null) return;
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  function fenced(context: PassContext): boolean {
    return session.kind === "live" && session.id === context.sessionId;
  }

  /** True when the failure ends this device's session; the caller stops. */
  function recordFailure(failure: CloudFailure): boolean {
    lastError = describeCloudFailure(failure);
    if (failure.kind !== "refused" || !SYNC_TERMINAL_CODES.has(failure.code)) {
      debug(lastError);
      publish();
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
    publish();
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
      publish();
      if (!result.value.hasMore) return true;
    }
    return true;
  }

  async function runPass(): Promise<void> {
    if (session.kind !== "live") return;
    const context: PassContext = {
      sessionId: session.id,
      client: session.client,
      deviceId: session.credential.deviceId,
    };
    if (!(await pullAndApply(context))) return;
    if (!fenced(context)) return;
    lastSyncedAt = Date.now();
    publish();
  }

  async function syncNow(): Promise<void> {
    if (session.kind !== "live") return;
    if (inflight !== null) {
      // Coalesced rather than queued: one more pass after this covers whatever
      // arrived while it ran.
      dirty = true;
      await inflight;
      return;
    }
    inflight = (async () => {
      try {
        for (;;) {
          dirty = false;
          await runPass();
          if (!dirty || session.kind !== "live") break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        debug(`sync pass failed: ${lastError}`);
        publish();
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  }

  return {
    subscribe: status.subscribe,
    get: status.get,

    setCredential(next) {
      if (next !== null && session.kind === "live" && sameCredential(next, session.credential)) {
        return;
      }
      closeSession();
      clearTimer();
      // A fresh pairing starts from a clean slate: the cursor and the applied
      // log describe an account this device may no longer be talking to.
      args.store.reset();
      lastError = null;
      lastSyncedAt = null;
      if (next === null) {
        sessionCounter += 1;
        session = { kind: "off", id: sessionCounter };
        publish();
        return;
      }
      openSession(next);
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
  };
}
