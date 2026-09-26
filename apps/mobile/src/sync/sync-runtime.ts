// the phone only pulls threads and never pushes or claims: a phone claiming a capture takes one the
// desktop never sees. while signed in and in the foreground it holds the account's socket, so a
// running turn's pushes are pulled as they land; the poll stays, since the socket is latency and
// never correctness.

import type { CaptureRequest, CaptureResponse } from "@repo/api/cloud/captures/captures-schema";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { createSocketLink } from "@repo/api/cloud/sync/socket-link";
import {
  createSingleFlight,
  createSyncSession,
  pullPages,
} from "@repo/api/cloud/sync/sync-session";
import type { SyncOutcome, SyncSessionHandle } from "@repo/api/cloud/sync/sync-session";
import { createCloudClient, describeCloudFailure } from "@repo/api/cloud/client";
import type {
  CloudClient,
  CloudFailure,
  CloudResult,
  CloudSocketOpener,
} from "@repo/api/cloud/client";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import type { SyncStore } from "./sync-store";

// restoring: no credential has been handed over yet, because the boot read of the stored one is
// in flight. a screen deciding between signed in and out has no answer until it ends.
export type SyncStatus =
  | { state: "restoring" }
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
  // never reset here: whether a credential is a restore or a new sign-in is the composition root's
  // to say, and only a restore keeps what the store holds
  store: Pick<SyncStore, "applyPlan" | "readCursor">;
  cloudUrl: string;
  createClient?: (credential: DeviceCredential) => CloudClient;
  pollIntervalMs?: number | null;
  // absent is poll-only; the app's is React Native's dial under the shared opener
  openSocket?: CloudSocketOpener;
  // another device pushed to the hosted vault
  onVaultPing?: () => void;
  // the dispatch inbox holds something for this phone: a question a Mac is waiting on
  onDispatchPing?: () => void;
  onDebug?: (message: string) => void;
}

// every other request under this sign-in rides the same session rather than a client of its own:
// one fence for all of them, and a revocation any of them hears ends the sign-in and publishes.
// a caller checks `fenced` after its await and before recording: recordFailure ends whichever
// session is live, so a late refusal from an earlier sign-in would end the next one.
export type SessionPort = Pick<
  SyncSessionHandle<DeviceCredential>,
  "current" | "fenced" | "recordFailure"
>;

export interface SyncRuntime extends ReadableStore<SyncStatus> {
  // null leaves `restoring` for signed-out when the boot read found nothing
  setCredential: (next: DeviceCredential | null) => void;
  createCapture: (request: CaptureRequest) => Promise<CloudResult<CaptureResponse>>;
  start: () => void;
  // the app is in the foreground again: the socket reopens and a pass runs
  resume: () => void;
  // the app left the foreground: the socket closes and nothing polls until it resumes
  suspend: () => void;
  syncNow: () => Promise<void>;
  session: SessionPort;
}

const sameCredential = (a: DeviceCredential, b: DeviceCredential): boolean =>
  a.deviceId === b.deviceId && a.credential === b.credential;

export const createSyncRuntime = (args: SyncRuntimeArgs): SyncRuntime => {
  const pollIntervalMs = args.pollIntervalMs === undefined ? POLL_INTERVAL_MS : args.pollIntervalMs;
  const debug = (message: string): void => {
    args.onDebug?.(message);
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let foreground = true;
  let lastError: string | null = null;
  let lastSyncedAt: number | null = null;
  const status = createExternalStore<SyncStatus>({ state: "restoring" });

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
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });
  const flight = createSingleFlight();

  // the socket asks for a pass once the pass exists; it cannot open before start()
  let requestPass: (() => void) | null = null;

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    canConnect: () => foreground && session.current().kind === "live",
    credential: () => {
      const current = session.current();
      return current.kind === "live" ? current.credential.credential : null;
    },
    listener: () => ({ platform: "mobile" }),
    onConnectionChanged: (connected) => {
      // a ping sent while the socket was down reached nothing; the pull carries what it announced
      if (connected) {
        requestPass?.();
      }
    },
    // a capture ping is the desktop's, which claims captures, and a sync ping the cursor covers
    // (the log's high-water) is already here
    onPing: (ping) => {
      if (ping.type === "vault") {
        args.onVaultPing?.();
      } else if (ping.type === "dispatch") {
        args.onDispatchPing?.();
      } else if (ping.type === "sync" && ping.seq > args.store.readCursor()) {
        requestPass?.();
      }
    },
    // a hint; only an http refusal ends the sign-in
    onSevered: () => {
      requestPass?.();
    },
    openSocket: args.openSocket ?? null,
  });

  const haltTransport = (): void => {
    clearTimer();
    link.close();
  };

  // never awaited: an unreachable cloud must not hold a sign-out open, and the row it leaves is the
  // Devices page's to revoke. its own client, because closing the session aborts every request the
  // session's client carries.
  const signOutBestEffort = async (credential: DeviceCredential): Promise<void> => {
    const client =
      args.createClient?.(credential) ??
      createCloudClient({ baseUrl: args.cloudUrl, credential: credential.credential });
    const result = await client.signOut();
    if (!result.ok) {
      debug(`sign-out did not revoke this device: ${describeCloudFailure(result.failure)}`);
    }
  };

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

  // only a terminal refusal is the sign-in's business; any other failure is its caller's to show.
  // every request under the sign-in records through here, so its end and the transport's are one.
  const recordFailure = (failure: CloudFailure): "continue" | "ended" => {
    const outcome = session.recordFailure(failure);
    if (outcome === "ended") {
      haltTransport();
      publish();
    }
    return outcome;
  };

  const recordPullFailure = (failure: CloudFailure): "continue" | "ended" => {
    lastError = describeCloudFailure(failure);
    const outcome = recordFailure(failure);
    if (outcome === "continue") {
      debug(lastError);
      publish();
    }
    return outcome;
  };

  const runPass = async (): Promise<SyncOutcome> => {
    const current = session.current();
    if (current.kind !== "live") {
      return "fenced";
    }
    const sessionId = current.id;
    const outcome = await pullPages({
      applyPlan: async (steps) => {
        await args.store.applyPlan(steps);
      },
      client: current.client,
      fenced: () => session.fenced(sessionId),
      onPage: () => {
        lastError = null;
        publish();
      },
      onSkipped: debug,
      // the phone never pushes, so no earlier sign-in of its own can be in the log.
      ownDeviceIds: new Set([current.credential.deviceId]),
      readCursor: () => args.store.readCursor(),
      recordFailure: recordPullFailure,
    });
    if (!session.fenced(sessionId)) {
      return "fenced";
    }
    // a capped pull is still catching up and a failed one never reached the log: neither is synced.
    if (outcome === "caught-up") {
      lastSyncedAt = Date.now();
      publish();
    }
    return outcome;
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

  requestPass = () => {
    void syncNow();
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

  // the transport a live sign-in runs while the app is in the foreground
  const runTransport = (): void => {
    if (!foreground || session.current().kind !== "live") {
      return;
    }
    armTimer();
    link.connect();
    void syncNow();
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
      const result = await current.client.createCapture(request);
      if (!result.ok && session.fenced(current.id)) {
        recordFailure(result.failure);
      }
      return result;
    },
    get: status.get,
    session: { current: session.current, fenced: session.fenced, recordFailure },
    setCredential(next) {
      const current = session.current();
      if (next !== null && current.kind === "live" && sameCredential(next, current.credential)) {
        return;
      }
      // a credential this phone drops still holds one of the account's device slots; an
      // unauthorized one is already refused, so nothing is left to revoke
      if (current.kind === "live") {
        void signOutBestEffort(current.credential);
      }
      haltTransport();
      link.resetBackoff();
      lastError = null;
      lastSyncedAt = null;
      if (next === null) {
        session.close();
      } else {
        session.open(next);
      }
      publish();
    },
    resume() {
      foreground = true;
      link.resetBackoff();
      runTransport();
    },
    start: runTransport,
    subscribe: status.subscribe,
    suspend() {
      foreground = false;
      haltTransport();
    },
    syncNow,
  };
};
