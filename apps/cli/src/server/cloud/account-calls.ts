import { createCloudClient } from "@repo/contract/cloud/client";
import type {
  CloudClient,
  CloudFailure,
  CloudResult,
  CreateCloudClientArgs,
} from "@repo/contract/cloud/client";
import { SYNC_TERMINAL_CODES } from "@repo/contract/cloud/errors";
import type { CloudErrorCode } from "@repo/contract/cloud/errors";
import type { SyncSession, SyncSessionHandle } from "@repo/contract/cloud/sync/sync-session";
import type {
  CloudDevicesResponse,
  CloudRevokeDeviceResponse,
  CloudStatusResponse,
} from "@repo/contract/local/cloud/cloud-schema";
import type { DeviceCredential } from "./credential-store";

// a call a person asks of the account over this device's live sign-in. `not-live`: none to ask
// with, or the cloud refused its credential just now, which ends the session as a pass's refusal would
export type AccountCallOutcome<TValue> =
  | { kind: "answered"; value: TValue }
  | { kind: "not-live"; message: string }
  | { kind: "failed"; failure: CloudFailure };

export type RevokeDeviceOutcome =
  | AccountCallOutcome<CloudRevokeDeviceResponse>
  | { kind: "this-device" };

const NOT_SIGNED_IN = "This Mac isn't signed in to an account.";
const SIGNED_OUT_BY_ACCOUNT = "This Mac was signed out of your account.";
const SIGN_IN_CHANGED = "This Mac's sign-in changed while that was asked. Try again.";
const UPDATE_TO_SYNC = "This version of Inteligir can't sync anymore. Update it to keep syncing.";
export const SHUTTING_DOWN: CloudFailure = {
  kind: "unreachable",
  message: "This app is shutting down.",
};

// what a terminal refusal of a call a person asked says: a sign-in ended, or a build the cloud refuses
const endedBecause = (code: CloudErrorCode): string =>
  code === "client-outdated" ? UPDATE_TO_SYNC : SIGNED_OUT_BY_ACCOUNT;

export interface AccountCallsDeps {
  session: SyncSessionHandle<DeviceCredential>;
  isDisposed: () => boolean;
  sessionAlive: (sessionId: number) => boolean;
  recordFailure: (failure: CloudFailure) => "continue" | "ended";
  clientArgs: (credential: string, signal: AbortSignal) => CreateCloudClientArgs;
  forgetDeletedAccount: () => CloudStatusResponse;
  status: () => CloudStatusResponse;
}

export interface AccountCalls {
  devices: () => Promise<AccountCallOutcome<CloudDevicesResponse>>;
  revokeDevice: (deviceId: string) => Promise<RevokeDeviceOutcome>;
  deleteAccount: (password: string) => Promise<AccountCallOutcome<CloudStatusResponse>>;
  dispose: () => void;
}

export const createAccountCalls = (deps: AccountCallsDeps): AccountCalls => {
  const { isDisposed, recordFailure, session, sessionAlive, status } = deps;

  // over the session's own client, fenced like a pass: an answer that lands after a sign-out or a
  // sign-in may speak for an account this device has left, and only a terminal refusal reaches
  // recordFailure, since any other is this call's alone and not the sync's last error
  const accountCall = async <TValue>(
    call: (live: {
      client: CloudClient;
      credential: DeviceCredential;
    }) => Promise<CloudResult<TValue>>,
  ): Promise<AccountCallOutcome<TValue>> => {
    const current = session.current();
    if (!isDisposed() && current.kind === "outdated") {
      return { kind: "not-live", message: UPDATE_TO_SYNC };
    }
    if (isDisposed() || current.kind !== "live") {
      return { kind: "not-live", message: NOT_SIGNED_IN };
    }
    const result = await call(current);
    if (!sessionAlive(current.id)) {
      return { kind: "not-live", message: SIGN_IN_CHANGED };
    }
    if (result.ok) {
      return { kind: "answered", value: result.value };
    }
    const { failure } = result;
    if (failure.kind === "refused" && SYNC_TERMINAL_CODES.has(failure.code)) {
      recordFailure(failure);
      return { kind: "not-live", message: endedBecause(failure.code) };
    }
    return { failure, kind: "failed" };
  };

  // its own client, as a sign-out's: the deletion revokes this very credential first, and a pass
  // that meets it ends the session, which aborts every request the session's client carries
  const deleteAbort = new AbortController();
  // the credential a deletion went out on whose answer never came back: the cloud may have
  // carried it out, and then a retry meets only that deletion's own revocation
  let unansweredDelete: string | null = null;

  const forgetDeletedAccount = (): CloudStatusResponse => {
    unansweredDelete = null;
    return deps.forgetDeletedAccount();
  };

  const deleteFromLiveSession = async (
    asked: Extract<SyncSession<DeviceCredential>, { kind: "live" }>,
    password: string,
  ): Promise<AccountCallOutcome<CloudStatusResponse>> => {
    const retried = asked.credential.credential === unansweredDelete;
    const client = createCloudClient(
      deps.clientArgs(asked.credential.credential, deleteAbort.signal),
    );
    const result = await client.deleteAccount(password);
    if (isDisposed()) {
      return { failure: SHUTTING_DOWN, kind: "failed" };
    }
    const now = session.current();
    // live still, or refused since by a pass that met the deletion's own revocation
    const sameSignIn =
      now.kind !== "off" && now.credential.credential === asked.credential.credential;
    if (result.ok) {
      return sameSignIn
        ? { kind: "answered", value: forgetDeletedAccount() }
        : { kind: "answered", value: status() };
    }
    const { failure } = result;
    if (failure.kind !== "refused") {
      unansweredDelete = asked.credential.credential;
    } else if (!SYNC_TERMINAL_CODES.has(failure.code)) {
      // the cloud checks the credential before anything it refuses past the build floor, so the
      // account is there
      unansweredDelete = null;
    }
    if (!sessionAlive(asked.id)) {
      if (now.kind === "outdated") {
        return { kind: "not-live", message: UPDATE_TO_SYNC };
      }
      if (sameSignIn && retried) {
        return { kind: "answered", value: forgetDeletedAccount() };
      }
      return { kind: "not-live", message: sameSignIn ? SIGNED_OUT_BY_ACCOUNT : SIGN_IN_CHANGED };
    }
    if (failure.kind === "refused" && SYNC_TERMINAL_CODES.has(failure.code)) {
      // the floor answers before the credential is read, so its refusal says nothing of the account
      if (retried && failure.code !== "client-outdated") {
        return { kind: "answered", value: forgetDeletedAccount() };
      }
      recordFailure(failure);
      return { kind: "not-live", message: endedBecause(failure.code) };
    }
    return { failure, kind: "failed" };
  };

  return {
    async deleteAccount(password) {
      const asked = session.current();
      if (isDisposed() || asked.kind === "off") {
        return { kind: "not-live", message: NOT_SIGNED_IN };
      }
      // the floor refuses whatever this build sends, a retry of an unanswered deletion included
      if (asked.kind === "outdated") {
        return { kind: "not-live", message: UPDATE_TO_SYNC };
      }
      if (asked.kind !== "live") {
        return asked.credential.credential === unansweredDelete
          ? { kind: "answered", value: forgetDeletedAccount() }
          : { kind: "not-live", message: NOT_SIGNED_IN };
      }
      return await deleteFromLiveSession(asked, password);
    },

    async devices() {
      return await accountCall(async ({ client, credential }) => {
        const result = await client.listDevices();
        if (!result.ok) {
          return result;
        }
        const devices = result.value.devices.flatMap((device) =>
          device.revokedAt === null
            ? [
                {
                  createdAt: device.createdAt,
                  current: device.id === credential.deviceId,
                  id: device.id,
                  lastSeenAt: device.lastSeenAt,
                  name: device.name,
                },
              ]
            : [],
        );
        return { ok: true, value: { devices } };
      });
    },

    dispose() {
      deleteAbort.abort();
    },

    async revokeDevice(deviceId) {
      // refused before any request: this device leaves through a sign-out, which also forgets its
      // credential and its queue, where a revoke would leave both behind, refused
      const current = session.current();
      if (current.kind !== "off" && current.credential.deviceId === deviceId) {
        return { kind: "this-device" };
      }
      return await accountCall(async ({ client }) => await client.revokeDevice(deviceId));
    },
  };
};
