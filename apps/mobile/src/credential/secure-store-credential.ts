// expo-secure-store, never AsyncStorage: a bearer secret in plaintext in the app sandbox.

import * as SecureStore from "expo-secure-store";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { parseStoredCredential, serializeCredential } from "./credential-codec";

const CREDENTIAL_KEY = "device-credential";

export const readDeviceCredential = async (): Promise<DeviceCredential | null> => {
  const raw = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  return parseStoredCredential(raw);
};

// AFTER_FIRST_UNLOCK: a background sync can read it after a reboot without exposing it on the
// lock screen.
export const writeDeviceCredential = async (credential: DeviceCredential): Promise<void> => {
  await SecureStore.setItemAsync(CREDENTIAL_KEY, serializeCredential(credential), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
};

export const clearDeviceCredential = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
};
