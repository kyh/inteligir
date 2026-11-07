// expo-secure-store, never AsyncStorage: a bearer secret in plaintext in the app sandbox. The
// module is handed in, so a suite can stand in for the Keychain.

import { DEVICE_CREDENTIAL_PATTERN } from "@repo/contract/cloud/device/device-schema";
import type * as SecureStore from "expo-secure-store";
import type { CredentialStore } from "../lib/compose-runtime";

export type Keychain = Pick<
  typeof SecureStore,
  "WHEN_UNLOCKED_THIS_DEVICE_ONLY" | "deleteItemAsync" | "getItemAsync" | "setItemAsync"
>;

const CREDENTIAL_KEY = "device-credential";

export const createKeychainCredentials = (keychain: Keychain): CredentialStore => ({
  clear: async () => {
    await keychain.deleteItemAsync(CREDENTIAL_KEY);
  },

  // a malformed record reads as "signed out", not as a credential the cloud refuses on every request
  read: async () => {
    const held = await keychain.getItemAsync(CREDENTIAL_KEY);
    return held !== null && DEVICE_CREDENTIAL_PATTERN.test(held) ? held : null;
  },

  // WHEN_UNLOCKED since nothing reads it behind a lock screen: the app runs nothing in the
  // background, and a share opens it in front. THIS_DEVICE_ONLY so no backup restores it onto
  // another phone, which would then act as this device. The key is deleted first because a set
  // over an existing item updates only its value, keeping the accessibility it was written with.
  write: async (credential) => {
    await keychain.deleteItemAsync(CREDENTIAL_KEY);
    await keychain.setItemAsync(CREDENTIAL_KEY, credential, {
      keychainAccessible: keychain.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
});
