// The phone's first run: a sign-in with the account's email and password, answering this phone's
// own device credential (`account.signIn` on `/v1/rpc`); an account is made on the site or the
// Mac, since the phone stays sign-in only (A DEVICE CAN ALSO CREATE THE ACCOUNT). The credential
// is kept in the Keychain before the library opens; a Keychain that refuses it is a sign-in that
// failed, and the cloud is told to let that device go, so no slot of the account is held by a
// phone that kept nothing. A refusal the contract declares says its own sentence.

import { normalizeDeviceName } from "@repo/contract/cloud/device/device-schema";
import type { DeviceLoginResponse } from "@repo/contract/cloud/device/device-schema";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { KeptCredential } from "../credential/credential-codec";
import { messageOf } from "../lib/error-message";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { refusalText } from "../lib/refusal-text";

export type LoginState =
  | { readonly kind: "idle" }
  | { readonly kind: "signing-in" }
  | { readonly kind: "failed"; readonly message: string };

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  // what the account's device list calls this phone
  readonly deviceName: string;
}

export interface LoginStoreArgs {
  // `/v1` with no credential yet, and with the one a sign-in just answered
  readonly client: (credential: string | null) => V1Client;
  // keeps the credential, then opens the library under it
  readonly signedIn: (kept: KeptCredential) => Promise<void>;
  readonly keep: (kept: KeptCredential) => Promise<void>;
}

export interface LoginStore extends ReadableStore<LoginState> {
  readonly login: (request: LoginRequest) => Promise<void>;
  // a Keychain that refuses outside a sign-in (the boot read, the sign-out delete) is shown here too
  readonly fail: (message: string) => void;
}

const DID_NOT_WORK = "That didn't work. Check your connection and try again.";

export const createLoginStore = (args: LoginStoreArgs): LoginStore => {
  const state = createExternalStore<LoginState>({ kind: "idle" });

  const ask = async (request: LoginRequest): Promise<DeviceLoginResponse> => {
    const { account } = args.client(null);
    return await account.signIn({
      deviceName: normalizeDeviceName(request.deviceName),
      email: request.email,
      password: request.password,
    });
  };

  const login = async (request: LoginRequest): Promise<void> => {
    // a second tap while the first is in flight is the same sign-in
    if (state.get().kind === "signing-in") {
      return;
    }
    state.set({ kind: "signing-in" });
    let answer: DeviceLoginResponse;
    try {
      answer = await ask(request);
    } catch (error) {
      state.set({ kind: "failed", message: refusalText(error, DID_NOT_WORK) });
      return;
    }
    const kept: KeptCredential = {
      credential: answer.credential,
      deviceId: answer.deviceId,
      email: answer.email,
    };
    try {
      await args.keep(kept);
    } catch (error) {
      try {
        await args.client(answer.credential).account.signOut();
      } catch {
        // the cloud did not take the sign-out either; the device list shows the slot to free
      }
      state.set({
        kind: "failed",
        message: `This iPhone couldn't keep your sign-in: ${messageOf(error)}`,
      });
      return;
    }
    try {
      await args.signedIn(kept);
      state.set({ kind: "idle" });
    } catch (error) {
      state.set({ kind: "failed", message: messageOf(error) });
    }
  };

  return {
    fail(message) {
      state.set({ kind: "failed", message });
    },
    get: state.get,
    login,
    subscribe: state.subscribe,
  };
};
