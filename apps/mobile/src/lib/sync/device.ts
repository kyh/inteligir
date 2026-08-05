// ---------------------------------------------------------------------------
// The device-identity composition root for mobile: it binds the Expo platform
// (expo-crypto's CSPRNG, the expo-secure-store keychain, the global fetch and
// clock) to the pure modules beside it, and exposes the enrollment as reactive
// state the screens read.
//
// One instance per app, module-scoped like the host environment store. Tests
// never import this file — they drive the pure factories with fakes.
// ---------------------------------------------------------------------------

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { createExternalStore } from "../external-store";
import type { StringStorePort } from "../host/environment-store";
import { generateDeviceKey, installRandomSource, mintDeviceAssertion } from "./device-key";
import { createDeviceStore, type EnrolledDevice } from "./device-store";
import { enrollWithPairingBlob, type EnrollResult } from "./enroll";

// The one place the device key's randomness is named, and the entry point
// matters: expo-crypto's `getRandomBytes` carries a __DEV__ branch that fills
// from Math.random() when remote debugging is on, so a key minted under a
// debugger would be silently, unrecoverably weak. `getRandomValues` has no
// such branch — it calls the native module and nothing else. React Native's
// ambient `crypto.getRandomValues` is not a CSPRNG either, and noble would
// reach for it unasked.
installRandomSource((byteCount) => Crypto.getRandomValues(new Uint8Array(byteCount)));

const secureStringStore: StringStorePort = {
  get: (key) => SecureStore.getItem(key),
  set: (key, value) => {
    SecureStore.setItem(key, value);
  },
  delete: (key) => {
    void SecureStore.deleteItemAsync(key);
  },
};

const store = createDeviceStore(secureStringStore);
const deviceState = createExternalStore<EnrolledDevice | null>(store.get());

/** This device's enrollment, or null when it has none. */
export function getDevice(): EnrolledDevice | null {
  return deviceState.get();
}

/** Subscribe a React component to the enrollment. */
export function useDevice(): EnrolledDevice | null {
  return useSyncExternalStore(deviceState.subscribe, deviceState.get);
}

/** Join the vault a pasted pairing blob names. */
export async function enrollDevice(blobText: string, deviceName: string): Promise<EnrollResult> {
  const result = await enrollWithPairingBlob(
    {
      store,
      generateKey: generateDeviceKey,
      fetchImpl: (input, init) => fetch(input, init),
      now: () => Date.now(),
    },
    blobText,
    deviceName,
  );
  if (result.ok) deviceState.set(result.device);
  return result;
}

/**
 * Stop syncing this vault from this phone: forget the key and the enrollment.
 * Purely local by design — the coordinator cannot tell "I am leaving" from
 * "strand this vault", and refuses the revoke that would do the latter. The
 * roster row stays, for the desktop to remove.
 */
export function disconnectDevice(): void {
  store.clear();
  deviceState.set(null);
}

/** Mint this device's bearer credential for one request. */
export function mintDeviceToken(device: EnrolledDevice): string {
  const key = store.key();
  if (key === null) {
    throw new Error(
      "sync: this device's sync key is unreadable — pair with the desktop again to mint a new one",
    );
  }
  return mintDeviceAssertion(key, device.vaultId, Date.now());
}
