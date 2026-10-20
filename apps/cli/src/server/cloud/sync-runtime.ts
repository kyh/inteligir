// the credential file is the switch: no second "enabled" flag, because two values that must agree
// can disagree. the account socket says another device moved the hosted vault, and a revoked
// device's socket is closed; neither is the verdict on the sign-in, which only a request under
// the credential hears, so a check runs at start, on the socket's open and close and on a timer.

import type { ClientBuild } from "@repo/contract/cloud/client-build";
import { createCloudClient, describeCloudFailure } from "@repo/contract/cloud/client";
import type {
  CloudEndpoint,
  CloudFailure,
  CloudFetch,
  CreateCloudClientArgs,
} from "@repo/contract/cloud/client";
import { normalizeDeviceName } from "@repo/contract/cloud/device/device-schema";
import { loginDevice, signUpDevice } from "@repo/contract/cloud/device/login-flow";
import type {
  DeviceCredentialStore,
  LoginOutcome as DeviceLoginOutcome,
} from "@repo/contract/cloud/device/login-flow";
import { CREDENTIAL_REFUSED_CODES } from "@repo/contract/cloud/errors";
import type { CloudSocketOpener } from "@repo/contract/cloud/sync/cloud-socket";
import { createSocketLink } from "@repo/contract/cloud/sync/socket-link";
import { checkSignIn, createSyncSession } from "@repo/contract/cloud/sync/sync-session";
import type {
  CloudDevicesResponse,
  CloudLoginRequest,
  CloudSignUpRequest,
  CloudStatusResponse,
} from "@repo/contract/local/cloud/cloud-schema";
import type { DebugLog } from "../debug-log";
import { createAccountCalls, SHUTTING_DOWN } from "./account-calls";
import type { AccountCallOutcome, RevokeDeviceOutcome } from "./account-calls";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "./credential-store";
import type { DeviceCredential } from "./credential-store";

// a shutdown's wait for a sign-out in flight: the client's own deadline is 30s, far past the
// cloud teardown step's budget, and a quit that overran it would exit non-zero.
const SIGN_OUT_GRACE_MS = 3000;

// a revocation that came while the socket was down, which no close reported, is heard by then.
const CHECK_INTERVAL_MS = 60_000;

export interface CloudTransport {
  fetch?: CloudFetch;
  /** absent means no socket. injected rather than defaulted because node's dial
   *  cannot be typed here (browser tsconfig). */
  openSocket?: CloudSocketOpener;
  /** null disables the check's timer. */
  pollIntervalMs?: number | null;
}

export interface CloudRuntimeArgs {
  dataDir: string;
  cloudUrl: string;
  /** the running build's version: every request names it. */
  build: string;
  /** the name a sign-in that names none gives this device (`readMachineName`). */
  machineName: string;
  transport?: CloudTransport;
  /** the vault ping's handler; also kicked once after a login so the derived remote syncs now. */
  onVaultPing?: () => void;
  /** what status() answers moved: a sign-in or out, a revocation, the socket, a check's end. */
  onStatusChanged?: () => void;
  onDebug?: (message: string) => void;
  /** INTELIGIR_DEBUG's sync trace, beside onDebug's always-on warnings. */
  debugLog?: DebugLog | undefined;
}

export type LoginOutcome =
  | { kind: "logged-in"; status: CloudStatusResponse }
  | Extract<DeviceLoginOutcome, { kind: "refused" }>;

export interface CloudRuntime {
  status: () => CloudStatusResponse;
  start: () => void;
  login: (request: CloudLoginRequest) => Promise<LoginOutcome>;
  /** creates the account and keeps its first credential, exactly as login keeps one. */
  signUp: (request: CloudSignUpRequest) => Promise<LoginOutcome>;
  logout: () => CloudStatusResponse;
  /** the account's devices still signed in, this one marked current. */
  devices: () => Promise<AccountCallOutcome<CloudDevicesResponse>>;
  /** cuts another of the account's devices off; this one signs out instead. */
  revokeDevice: (deviceId: string) => Promise<RevokeDeviceOutcome>;
  /** ends the account and forgets this device's sign-in; the vault is left as it is. */
  deleteAccount: (password: string) => Promise<AccountCallOutcome<CloudStatusResponse>>;
  /** the account socket is up, so another device's vault push pings this one. */
  pingsReach: () => boolean;
  dispose: () => Promise<void>;
}

export const createCloudRuntime = (args: CloudRuntimeArgs): CloudRuntime => {
  const transport = args.transport ?? {};
  const checkIntervalMs =
    transport.pollIntervalMs === undefined ? CHECK_INTERVAL_MS : transport.pollIntervalMs;
  const debug =
    args.onDebug ??
    ((message: string) => {
      console.error(`cloud: ${message}`);
    });

  let lastError: string | null = null;
  let revokeError: string | null = null;
  let disposed = false;
  let checkTimer: ReturnType<typeof setInterval> | null = null;

  const notifyStatus = (): void => {
    args.onStatusChanged?.();
  };

  const clientBuild: ClientBuild = { platform: "desktop", version: args.build };

  const endpoint = (): CloudEndpoint => {
    const target: CloudEndpoint = { baseUrl: args.cloudUrl, build: clientBuild };
    if (transport.fetch !== undefined) {
      target.fetch = transport.fetch;
    }
    return target;
  };

  const clientArgs = (credential: string, signal: AbortSignal): CreateCloudClientArgs => ({
    ...endpoint(),
    credential,
    signal,
  });

  const session = createSyncSession<DeviceCredential>({
    debugLog: args.debugLog,
    makeClient: (credential, signal) =>
      createCloudClient(clientArgs(credential.credential, signal)),
    onEnded: (failure) => {
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });

  // settles once every sign-out sent so far has, so a shutdown right after one still gives the
  // slot back; a shutdown aborts whatever is still in flight after SIGN_OUT_GRACE_MS.
  let signOutsSettled: Promise<void> = Promise.resolve();
  const signOutAbort = new AbortController();

  // never awaited by the caller: an unreachable cloud must not hold a sign-out open, and the row it
  // leaves is another device's to revoke, which the signed-out status says. its own client,
  // because closing the session aborts every request the session's client carries.
  const signOutBestEffort = (credential: DeviceCredential): void => {
    const client = createCloudClient(clientArgs(credential.credential, signOutAbort.signal));
    const earlier = signOutsSettled;
    signOutsSettled = (async () => {
      const result = await client.signOut();
      if (!result.ok) {
        const message = describeCloudFailure(result.failure);
        debug(`sign-out did not revoke this device: ${message}`);
        // a credential the cloud refuses is no longer live: no other device has anything to remove.
        const refusedCredential =
          result.failure.kind === "refused" && CREDENTIAL_REFUSED_CODES.has(result.failure.code);
        if (!refusedCredential) {
          revokeError = message;
          notifyStatus();
        }
      }
      await earlier;
    })();
  };

  const sessionAlive = (sessionId: number): boolean => !disposed && session.fenced(sessionId);

  const live = (): boolean => !disposed && session.current().kind === "live";

  const openSession = (credential: DeviceCredential): void => {
    session.open(credential);
    notifyStatus();
  };

  const stored = readDeviceCredential(args.dataDir);
  if (stored !== null) {
    openSession(stored);
  }

  // the socket and the timer both ask for a check, and a check's refusal tears both down; it is
  // bound once the check exists, before either can fire.
  let requestCheck: (() => void) | null = null;

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    build: clientBuild,
    canConnect: live,
    credential: () => {
      const current = session.current();
      return current.kind === "live" ? current.credential.credential : null;
    },
    // another device's push: the git engine's pass, not this runtime's.
    onPing: () => {
      args.onVaultPing?.();
    },
    onConnectionChanged: (connected) => {
      notifyStatus();
      // a ping sent while this socket was not up reached nothing, so the vault's pass runs for
      // what another device pushed meanwhile, and a revocation it missed is heard now.
      if (connected) {
        requestCheck?.();
        args.onVaultPing?.();
      }
    },
    onSevered: () => {
      // a hint; only an http refusal is authoritative.
      requestCheck?.();
    },
    openSocket: transport.openSocket ?? null,
  });

  const clearTimer = (): void => {
    if (checkTimer !== null) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  };

  const armTimer = (): void => {
    if (!live() || checkIntervalMs === null || checkTimer !== null) {
      return;
    }
    checkTimer = setInterval(() => {
      requestCheck?.();
    }, checkIntervalMs);
    checkTimer.unref?.();
  };

  const haltTransport = (): void => {
    link.close();
    clearTimer();
  };

  // the session ends only through here, so its end and the transport's teardown stay one event.
  const recordFailure = (failure: CloudFailure): "continue" | "ended" => {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "ended") {
      haltTransport();
      notifyStatus();
    } else {
      debug(lastError);
    }
    return outcome;
  };

  // a refusal is the revocation the socket's close only hinted at, and any other failure is no
  // verdict on the sign-in.
  const check = async (): Promise<void> => {
    const sessionId = session.current().id;
    if (disposed) {
      return;
    }
    const checked = await checkSignIn(session);
    if (checked.kind === "fenced" || disposed) {
      return;
    }
    if (checked.kind === "live") {
      lastError = null;
    } else {
      recordFailure(checked.failure);
    }
    args.debugLog?.(`session ${sessionId} check: ${checked.kind === "live" ? "live" : "refused"}`);
    notifyStatus();
  };

  requestCheck = (): void => {
    void check();
  };

  const status = (): CloudStatusResponse => {
    const current = session.current();
    switch (current.kind) {
      case "off": {
        return { cloudUrl: args.cloudUrl, revokeError, state: "signed-out" };
      }
      case "unauthorized": {
        return {
          cloudUrl: args.cloudUrl,
          detail: current.detail,
          deviceId: current.credential.deviceId,
          state: "unauthorized",
        };
      }
      case "outdated": {
        return {
          cloudUrl: args.cloudUrl,
          deviceId: current.credential.deviceId,
          state: "outdated",
        };
      }
      case "live": {
        return {
          accountEmail: current.credential.email,
          cloudUrl: args.cloudUrl,
          connected: link.isConnected(),
          deviceId: current.credential.deviceId,
          lastError,
          state: "signed-in",
        };
      }
      default: {
        const exhaustive: never = current;
        return exhaustive;
      }
    }
  };

  // the transport a live sign-in runs
  const runTransport = (): void => {
    if (!live()) {
      return;
    }
    armTimer();
    link.connect();
    requestCheck?.();
  };

  const adoptCredential = async (credential: DeviceCredential): Promise<void> => {
    if (disposed) {
      // teardown ran during the login round trip: write nothing after it.
      throw new Error("This app is shutting down; the credential was not kept.");
    }
    const previous = session.current();
    // openSession ends the old session, which fences an answer still in flight under it.
    haltTransport();
    writeDeviceCredential(args.dataDir, credential);
    revokeError = null;
    openSession(credential);
    // only once the new credential is kept: a failed write leaves the previous one this device's key
    if (previous.kind === "live") {
      signOutBestEffort(previous.credential);
    }
    lastError = null;
    link.resetBackoff();
    armTimer();
    link.connect();
    // the login just derived a hosted remote; sync it now.
    args.onVaultPing?.();
    // answered once the cloud has taken the new credential, as the status the login returns says
    await check();
  };

  const forgetSignIn = (): CloudStatusResponse => {
    session.close();
    haltTransport();
    clearDeviceCredential(args.dataDir);
    lastError = null;
    link.resetBackoff();
    notifyStatus();
    return status();
  };

  const accountCalls = createAccountCalls({
    clientArgs,
    // no sign-out: every device row went with the account, so none is left to revoke
    forgetDeletedAccount: () => {
      revokeError = null;
      return forgetSignIn();
    },
    isDisposed: () => disposed,
    recordFailure,
    session,
    sessionAlive,
    status,
  });

  // login and sign-up both end in a credential this device adopts, through the one store, which
  // keeps the name it joined under: the vault's commits carry it.
  const joinAccount = async (
    requestedName: string | undefined,
    join: (store: DeviceCredentialStore, deviceName: string) => Promise<DeviceLoginOutcome>,
  ): Promise<LoginOutcome> => {
    if (disposed) {
      return { failure: SHUTTING_DOWN, kind: "refused" };
    }
    const deviceName = normalizeDeviceName(requestedName ?? args.machineName);
    const outcome = await join(
      {
        write: async (login) => {
          await adoptCredential({ ...login, deviceName });
        },
      },
      deviceName,
    );
    return outcome.kind === "logged-in" ? { kind: "logged-in", status: status() } : outcome;
  };

  return {
    deleteAccount: accountCalls.deleteAccount,

    devices: accountCalls.devices,

    async dispose() {
      disposed = true;
      haltTransport();
      accountCalls.dispose();
      // a check in flight observes the abort rather than being waited out.
      session.abort();
      const grace = setTimeout(() => {
        signOutAbort.abort();
      }, SIGN_OUT_GRACE_MS);
      grace.unref?.();
      try {
        await signOutsSettled;
      } finally {
        clearTimeout(grace);
      }
    },

    async login(request) {
      return await joinAccount(
        request.deviceName,
        async (store, deviceName) =>
          await loginDevice({
            client: endpoint(),
            deviceName,
            email: request.email,
            password: request.password,
            store,
          }),
      );
    },

    logout() {
      // an unauthorized credential is one the cloud already refused: nothing is left to revoke. an
      // outdated one is still live there, and the refused revoke says so on the signed-out status
      const current = session.current();
      if (current.kind === "live" || current.kind === "outdated") {
        signOutBestEffort(current.credential);
      }
      return forgetSignIn();
    },

    pingsReach: () => session.current().kind === "live" && link.isConnected(),

    revokeDevice: accountCalls.revokeDevice,

    async signUp(request) {
      return await joinAccount(
        request.deviceName,
        async (store, deviceName) =>
          await signUpDevice({
            client: endpoint(),
            deviceName,
            email: request.email,
            inviteCode: request.inviteCode,
            name: request.name,
            password: request.password,
            store,
          }),
      );
    },

    start: runTransport,

    status,
  };
};
