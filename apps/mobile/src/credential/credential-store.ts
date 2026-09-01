// The credential-at-rest PORT. One durable thing lives behind it — the device
// credential — and the production adapter is expo-secure-store (the Keychain /
// Keystore), NEVER AsyncStorage: the credential is a bearer secret, and
// AsyncStorage is plaintext in the app sandbox. The unit suite drives a fake.

import type { DeviceCredential } from "@repo/api/cloud/pairing/pairing-schema";

export interface CredentialStore {
  /** The stored credential, or null when unpaired / unreadable. */
  read(): Promise<DeviceCredential | null>;
  write(credential: DeviceCredential): Promise<void>;
  clear(): Promise<void>;
}
