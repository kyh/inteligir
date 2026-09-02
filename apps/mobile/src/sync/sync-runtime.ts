// the phone only pulls threads and never pushes or claims: a phone claiming a capture takes one the
// desktop never sees.

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

const POLL_INTERVAL_MS = 60_000;

export interface SyncRuntimeArgs {
  store: SyncStore;
  cloudUrl: string;
  createClient?: (credential: DeviceCredential) => CloudClient;
  pollIntervalMs?: number | null;
}

export interface SyncRuntime extends ReadableStore<SyncStatus> {
  setCredential(next: DeviceCredential | null): void;
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
      // a different credential may be a different account; the cursor and log must not carry over.
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
