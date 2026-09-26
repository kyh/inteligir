// expo-secure-store, never AsyncStorage: a bearer secret in plaintext in the app sandbox. The
// module is handed in, so a suite can stand in for the Keychain.

import type * as SecureStore from "expo-secure-store";
import type { CredentialStore } from "../lib/compose-runtime";
import { parseStoredCredential, serializeCredential } from "./credential-codec";

export type Keychain = Pick<
  typeof SecureStore,
  "AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY" | "deleteItemAsync" | "getItemAsync" | "setItemAsync"
>;

const CREDENTIAL_KEY = "device-credential";

export const createKeychainCredentials = (keychain: Keychain): CredentialStore => ({
  clear: async () => {
    await keychain.deleteItemAsync(CREDENTIAL_KEY);
  },

  read: async () => parseStoredCredential(await keychain.getItemAsync(CREDENTIAL_KEY)),

  // AFTER_FIRST_UNLOCK so a background sync can read it after a reboot without exposing it on the
  // lock screen; THIS_DEVICE_ONLY so no backup restores it onto another phone, which would then
  // act as this device. The key is deleted first because a set over an existing item updates only
  // its value, keeping the accessibility it was written with, and a revoked credential stays
  // stored until the next sign-in writes over it.
  write: async (credential) => {
    await keychain.deleteItemAsync(CREDENTIAL_KEY);
    await keychain.setItemAsync(CREDENTIAL_KEY, serializeCredential(credential), {
      keychainAccessible: keychain.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
});
