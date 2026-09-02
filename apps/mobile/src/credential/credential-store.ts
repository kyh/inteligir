// the adapter is expo-secure-store, never AsyncStorage: a bearer secret in plaintext in the app
// sandbox.

import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";

export interface CredentialStore {
  read(): Promise<DeviceCredential | null>;
  write(credential: DeviceCredential): Promise<void>;
  clear(): Promise<void>;
}
