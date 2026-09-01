// The production `CredentialStore`: expo-secure-store, and nothing else touches
// the credential at rest. `AFTER_FIRST_UNLOCK` lets a background sync read it
// after the first unlock following a reboot, without exposing it on the lock
// screen — the standard accessibility for a token a background task presents.

import * as SecureStore from "expo-secure-store";
import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";
import { parseStoredCredential, serializeCredential } from "./credential-codec";
import type { CredentialStore } from "./credential-store";

const CREDENTIAL_KEY = "device-credential";

export function createSecureStoreCredential(): CredentialStore {
  return {
    async read(): Promise<DeviceCredential | null> {
      const raw = await SecureStore.getItemAsync(CREDENTIAL_KEY);
      return parseStoredCredential(raw);
    },
    async write(credential: DeviceCredential): Promise<void> {
      await SecureStore.setItemAsync(CREDENTIAL_KEY, serializeCredential(credential), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    },
    async clear(): Promise<void> {
      await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
    },
  };
}
