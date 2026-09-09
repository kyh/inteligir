// the phone only pulls threads and never pushes or claims: a phone claiming a capture takes one the
// desktop never sees.

import type { CaptureRequest, CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import {
  createSingleFlight,
  createSyncSession,
  pullPages,
} from "@repo/api/cloud/sync/sync-session";
import { createCloudClient, describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, CloudFailure, CloudResult } from "@repo/api/cloud/client";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { applyPlan } from "./thread-log";
import type { SyncStore } from "./sync-store";

export type SyncStatus =
  | { state: "signed-out" }
  | { state: "unauthorized"; deviceId: string; detail: string }
  | {
      state: "signed-in";
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
  setCredential: (next: DeviceCredential | null) => void;
  createCapture: (request: CaptureRequest) => Promise<CloudResult<CaptureResponse>>;
  start: () => void;
  syncNow: () => Promise<void>;
}

const sameCredential = (a: DeviceCredential, b: DeviceCredential): boolean =>
  a.deviceId === b.deviceId && a.credential === b.credential;

const debug = (message: string): void => {
  console.warn(`sync: ${message}`);
};

export const createSyncRuntime = (args: SyncRuntimeArgs): SyncRuntime => {
  const pollIntervalMs = args.pollIntervalMs === undefined ? POLL_INTERVAL_MS : args.pollIntervalMs;

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastError: string | null = null;
  let lastSyncedAt: number | null = null;
  const status = createExternalStore<SyncStatus>({ state: "signed-out" });

  const clearTimer = (): void => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const session = createSyncSession<DeviceCredential>({
    makeClient: (credential, signal) => {
      if (args.createClient !== undefined) {
        return args.createClient(credential);
      }
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

  const publish = (): void => {
    const current = session.current();
    switch (current.kind) {
      case "off": {
        status.set({ state: "signed-out" });
        return;
      }
      case "unauthorized": {
        status.set({
          detail: current.detail,
          deviceId: current.credential.deviceId,
          state: "unauthorized",
        });
        return;
      }
      case "live": {
        status.set({
          cursor: args.store.readCursor(),
          deviceId: current.credential.deviceId,
          lastError,
          lastSyncedAt,
          state: "signed-in",
        });
      }
      // no default
    }
  };

  const recordFailure = (failure: CloudFailure): "continue" | "ended" => {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "continue") {
      debug(lastError);
    }
    publish();
    return outcome;
  };

  const runPass = async (): Promise<void> => {
    const current = session.current();
    if (current.kind !== "live") {
      return;
    }
    const sessionId = current.id;
    const done = await pullPages({
      applyPlan: (steps) => {
        applyPlan(args.store, steps);
      },
      client: current.client,
      deviceId: current.credential.deviceId,
      fenced: () => session.fenced(sessionId),
      onPage: () => {
        lastError = null;
        publish();
      },
      onSkipped: debug,
      readCursor: () => args.store.readCursor(),
      recordFailure,
    });
    if (!done) {
      return;
    }
    if (!session.fenced(sessionId)) {
      return;
    }
    lastSyncedAt = Date.now();
    publish();
  };

  const syncNow = async (): Promise<void> => {
    if (session.current().kind !== "live") {
      return;
    }
    await flight.run({
      onError: (message) => {
        lastError = message;
        debug(`sync pass failed: ${message}`);
        publish();
      },
      pass: runPass,
      repeat: () => session.current().kind === "live",
    });
  };

  const armTimer = (): void => {
    if (session.current().kind !== "live" || pollIntervalMs === null || pollTimer !== null) {
      return;
    }
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    pollTimer.unref?.();
  };

  return {
    async createCapture(request) {
      const current = session.current();
      if (current.kind !== "live") {
        return {
          failure: { kind: "unreachable", message: "signed out" },
          ok: false,
        };
      }
      return await current.client.createCapture(request);
    },
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
    start() {
      if (session.current().kind !== "live") {
        return;
      }
      armTimer();
      void syncNow();
    },
    subscribe: status.subscribe,
    syncNow,
  };
};
