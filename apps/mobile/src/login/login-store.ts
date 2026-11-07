// The phone's first run: a sign-in with the account's email and password, answering this phone's
// own device credential (`account.signIn` on `/v1/rpc`); an account is made on the site or the
// Mac, since the phone stays sign-in only (A DEVICE CAN ALSO CREATE THE ACCOUNT). The credential
// is kept in the Keychain before the library opens; a Keychain that refuses it, or a library that
// will not open under it, is a sign-in that failed, and the cloud is told to let that device go and
// the Keychain to forget it, so no slot of the account is held by a phone that keeps nothing. A
// request the contract would refuse (an address that is none, a password too short) is said here
// and never sent; a refusal the contract declares says its own sentence.

import {
  deviceLoginRequestSchema,
  normalizeDeviceName,
} from "@repo/contract/cloud/device/device-schema";
import type { DeviceLoginResponse } from "@repo/contract/cloud/device/device-schema";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { KeptCredential } from "../credential/credential-codec";
import { messageOf } from "../lib/error-message";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { refusalText } from "@repo/contract/cloud/refusal-text";

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
  // opens the library under the credential `keep` kept
  readonly signedIn: (kept: KeptCredential) => Promise<void>;
  readonly keep: (kept: KeptCredential) => Promise<void>;
  // lets go of the credential `keep` kept
  readonly forget: () => Promise<void>;
}

export interface LoginStore extends ReadableStore<LoginState> {
  readonly login: (request: LoginRequest) => Promise<void>;
  // a Keychain that refuses the boot read is shown here too
  readonly fail: (message: string) => void;
}

const DID_NOT_WORK = "That didn't work. Check your connection and try again.";
const NOT_A_SIGN_IN = "Check your email and password.";

export const createLoginStore = (args: LoginStoreArgs): LoginStore => {
  const state = createExternalStore<LoginState>({ kind: "idle" });

  // the device the answer named, let go at the cloud; best-effort, since the device list shows a
  // slot the cloud did not free
  const letGo = async (credential: string): Promise<void> => {
    try {
      await args.client(credential).account.signOut();
    } catch {
      // the cloud did not take the sign-out either; the device list shows the slot to free
    }
  };

  const login = async (request: LoginRequest): Promise<void> => {
    // a second tap while the first is in flight is the same sign-in
    if (state.get().kind === "signing-in") {
      return;
    }
    const asked = deviceLoginRequestSchema.safeParse({
      deviceName: normalizeDeviceName(request.deviceName),
      email: request.email,
      password: request.password,
    });
    if (!asked.success) {
      state.set({ kind: "failed", message: NOT_A_SIGN_IN });
      return;
    }
    state.set({ kind: "signing-in" });
    let answer: DeviceLoginResponse;
    try {
      answer = await args.client(null).account.signIn(asked.data);
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
      await letGo(answer.credential);
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
      await letGo(answer.credential);
      try {
        await args.forget();
      } catch {
        // a Keychain that kept the credential and now refuses to forget it: the next launch reads a
        // credential the cloud refuses, and signs out
      }
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
