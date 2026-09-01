// The RN sync loop: page the account's merged thread log forward and apply into
// the store the UI reads. The node twin is apps/cli/src/server/cloud/sync-runtime.ts;
// both ride the contract's own session machinery
// (`@repo/api/cloud/sync/sync-session`) — the session fence, the single-flight
// pass and the page loop — over React Native storage here.
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
// THE STATUS IS PUBLISHED, NOT POLLED. Most passes run off the timer with no
// caller to read their answer, so the runtime itself is the store the screen
// subscribes to: the snapshot is rebuilt at every point the session, a pass or
// the cursor moves, and cached between them — `useSyncExternalStore` treats a
// fresh reference as new state, so a snapshot built per read is an infinite
// render loop.

import type { CaptureRequest, CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";
import {
  createSingleFlight,
  createSyncSession,
  pullPages,
} from "@repo/api/cloud/sync/sync-session";
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

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastError: string | null = null;
  let lastSyncedAt: number | null = null;
  const status = createExternalStore<SyncStatus>({ state: "off" });

  const session = createSyncSession<DeviceCredential>({
    makeClient: (credential, signal) => {
      if (args.createClient !== undefined) return args.createClient(credential);
      return createCloudClient({
        baseUrl: args.cloudUrl,
        credential: credential.credential,
        signal,
      });
    },
    onEnded: (failure) => {
      clearTimer();
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });
  const flight = createSingleFlight();

  function publish(): void {
    const current = session.current();
    switch (current.kind) {
      case "off":
        status.set({ state: "off" });
        return;
      case "unauthorized":
        status.set({
          state: "unauthorized",
          deviceId: current.credential.deviceId,
          detail: current.detail,
        });
        return;
      case "live":
        status.set({
          state: "paired",
          deviceId: current.credential.deviceId,
          cursor: args.store.readCursor(),
          lastSyncedAt,
          lastError,
        });
    }
  }

  function clearTimer(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function armTimer(): void {
    if (session.current().kind !== "live" || pollIntervalMs === null || pollTimer !== null) return;
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  function recordFailure(failure: CloudFailure): "continue" | "ended" {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "continue") debug(lastError);
    publish();
    return outcome;
  }

  async function runPass(): Promise<void> {
    const current = session.current();
    if (current.kind !== "live") return;
    const sessionId = current.id;
    const done = await pullPages({
      client: current.client,
      deviceId: current.credential.deviceId,
      fenced: () => session.fenced(sessionId),
      readCursor: () => args.store.readCursor(),
      applyPlan: (steps) => {
        applyPlan(args.store, steps);
      },
      recordFailure,
      onPage: () => {
        lastError = null;
        publish();
      },
      onSkipped: debug,
    });
    if (!done) return;
    if (!session.fenced(sessionId)) return;
    lastSyncedAt = Date.now();
    publish();
  }

  function syncNow(): Promise<void> {
    if (session.current().kind !== "live") return Promise.resolve();
    return flight.run({
      pass: runPass,
      repeat: () => session.current().kind === "live",
      onError: (message) => {
        lastError = message;
        debug(`sync pass failed: ${message}`);
        publish();
      },
    });
  }

  return {
    subscribe: status.subscribe,
    get: status.get,

    setCredential(next) {
      const current = session.current();
      if (next !== null && current.kind === "live" && sameCredential(next, current.credential)) {
        return;
      }
      clearTimer();
      // A fresh pairing starts from a clean slate: the cursor and the applied
      // log describe an account this device may no longer be talking to.
      args.store.reset();
      lastError = null;
      lastSyncedAt = null;
      if (next === null) {
        session.close();
      } else {
        session.open(next);
      }
      publish();
    },

    createCapture(request) {
      const current = session.current();
      if (current.kind !== "live") {
        return Promise.resolve({
          ok: false,
          failure: { kind: "unreachable", message: "not paired" },
        });
      }
      return current.client.createCapture(request);
    },

    start() {
      if (session.current().kind !== "live") return;
      armTimer();
      void syncNow();
    },

    syncNow,
  };
}
