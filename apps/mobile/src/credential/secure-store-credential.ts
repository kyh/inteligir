// expo-secure-store, never AsyncStorage: a bearer secret in plaintext in the app sandbox.

import * as SecureStore from "expo-secure-store";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { parseStoredCredential, serializeCredential } from "./credential-codec";

const CREDENTIAL_KEY = "device-credential";

export async function readDeviceCredential(): Promise<DeviceCredential | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIAL_KEY);
  return parseStoredCredential(raw);
}

// AFTER_FIRST_UNLOCK: a background sync can read it after a reboot without exposing it on the
// lock screen.
export function writeDeviceCredential(credential: DeviceCredential): Promise<void> {
  return SecureStore.setItemAsync(CREDENTIAL_KEY, serializeCredential(credential), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export function clearDeviceCredential(): Promise<void> {
  return SecureStore.deleteItemAsync(CREDENTIAL_KEY);
}
