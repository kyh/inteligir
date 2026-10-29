// the phone's sign-in: one session every request under it rides, and while it is live and the app
// is in the foreground, the account's socket, which says another device moved the hosted vault.
// the socket is latency and never correctness: a check of the sign-in runs as it opens, as a
// revoked device's socket closes and on a timer, since only a request hears the verdict.

import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import { createSocketLink } from "@repo/contract/cloud/sync/socket-link";
import { checkSignIn, createSyncSession } from "@repo/contract/cloud/sync/sync-session";
import type { SyncSessionHandle } from "@repo/contract/cloud/sync/sync-session";
import { createCloudClient, describeCloudFailure } from "@repo/contract/cloud/client";
import type { ClientBuild } from "@repo/contract/cloud/client-build";
import type { CloudClient, CloudFailure } from "@repo/contract/cloud/client";
import type { CloudSocketOpener } from "@repo/contract/cloud/sync/cloud-socket";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";

// restoring: no credential has been handed over yet, because the boot read of the stored one is
// in flight. a screen deciding between signed in and out has no answer until it ends. outdated:
// the cloud refused this build, not the sign-in, which an update resumes.
export type SyncStatus =
  | { state: "restoring" }
  | { state: "signed-out" }
  | { state: "unauthorized"; deviceId: string; detail: string }
  | { state: "outdated"; deviceId: string }
  | { state: "signed-in"; deviceId: string };

const CHECK_INTERVAL_MS = 60_000;

export interface SyncRuntimeArgs {
  cloudUrl: string;
  // what every request says this app is: the cloud refuses a build below its floor
  build: ClientBuild;
  createClient?: (credential: DeviceCredential) => CloudClient;
  // null disables the check's timer
  pollIntervalMs?: number | null;
  // absent is no socket; the app's is React Native's dial under the shared opener
  openSocket?: CloudSocketOpener;
  // another device pushed to the hosted vault
  onVaultPing?: () => void;
  onDebug?: (message: string) => void;
}

// every request under this sign-in rides the same session rather than a client of its own:
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
  start: () => void;
  // the app is in the foreground again: the socket reopens and the sign-in is checked
  resume: () => void;
  // the app left the foreground: the socket closes and nothing checks until it resumes
  suspend: () => void;
  session: SessionPort;
}

const sameCredential = (a: DeviceCredential, b: DeviceCredential): boolean =>
  a.deviceId === b.deviceId && a.credential === b.credential;

export const createSyncRuntime = (args: SyncRuntimeArgs): SyncRuntime => {
  const checkIntervalMs =
    args.pollIntervalMs === undefined ? CHECK_INTERVAL_MS : args.pollIntervalMs;
  const debug = (message: string): void => {
    args.onDebug?.(message);
  };

  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let foreground = true;
  const status = createExternalStore<SyncStatus>({ state: "restoring" });

  const clearTimer = (): void => {
    if (checkTimer !== null) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  };

  const session = createSyncSession<DeviceCredential>({
    makeClient: (credential, signal) => {
      if (args.createClient !== undefined) {
        return args.createClient(credential);
      }
      return createCloudClient({
        baseUrl: args.cloudUrl,
        build: args.build,
        credential: credential.credential,
        signal,
      });
    },
    onEnded: (failure) => {
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });

  // the socket asks for a check once the check exists; it cannot open before start()
  let requestCheck: (() => void) | null = null;

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    build: args.build,
    canConnect: () => foreground && session.current().kind === "live",
    credential: () => {
      const current = session.current();
      return current.kind === "live" ? current.credential.credential : null;
    },
    onConnectionChanged: (connected) => {
      // a revocation that came while the socket was down is heard now
      if (connected) {
        requestCheck?.();
      }
    },
    onPing: () => {
      args.onVaultPing?.();
    },
    // a hint; only an http refusal ends the sign-in
    onSevered: () => {
      requestCheck?.();
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
      createCloudClient({
        baseUrl: args.cloudUrl,
        build: args.build,
        credential: credential.credential,
      });
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
      case "outdated": {
        status.set({ deviceId: current.credential.deviceId, state: "outdated" });
        return;
      }
      case "live": {
        status.set({ deviceId: current.credential.deviceId, state: "signed-in" });
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

  const check = async (): Promise<void> => {
    const checked = await checkSignIn(session);
    if (checked.kind === "failed" && recordFailure(checked.failure) === "continue") {
      debug(describeCloudFailure(checked.failure));
    }
  };

  requestCheck = () => {
    void check();
  };

  const armTimer = (): void => {
    if (session.current().kind !== "live" || checkIntervalMs === null || checkTimer !== null) {
      return;
    }
    checkTimer = setInterval(() => {
      requestCheck?.();
    }, checkIntervalMs);
    checkTimer.unref?.();
  };

  // the transport a live sign-in runs while the app is in the foreground
  const runTransport = (): void => {
    if (!foreground || session.current().kind !== "live") {
      return;
    }
    armTimer();
    link.connect();
    requestCheck?.();
  };

  return {
    get: status.get,
    resume() {
      foreground = true;
      link.resetBackoff();
      runTransport();
    },
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
      if (next === null) {
        session.close();
      } else {
        session.open(next);
      }
      publish();
    },
    start: runTransport,
    subscribe: status.subscribe,
    suspend() {
      foreground = false;
      haltTransport();
    },
  };
};
