// expo-secure-store as Better Auth's Expo client keeps the phone's session in it, never
// AsyncStorage: a session in plaintext in the app sandbox. The module is handed in, so a suite can
// stand in for the Keychain.

import type { ExpoClientStorage } from "@better-auth/expo/client";
import type * as SecureStore from "expo-secure-store";

export type Keychain = Pick<
  typeof SecureStore,
  "WHEN_UNLOCKED_THIS_DEVICE_ONLY" | "getItem" | "getItemAsync" | "setItem" | "setItemAsync"
>;

// WHEN_UNLOCKED since nothing reads it behind a lock screen: the app runs nothing in the
// background, and a share opens it in front. THIS_DEVICE_ONLY so no backup restores the session
// onto another phone, which would then act as this one. Bare SecureStore writes WHEN_UNLOCKED,
// which a backup carries.
export const keychainStorage = (keychain: Keychain): ExpoClientStorage => {
  const options = { keychainAccessible: keychain.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  return {
    getItem: (key) => keychain.getItem(key),
    getItemAsync: async (key) => await keychain.getItemAsync(key),
    setItem: (key, value) => {
      keychain.setItem(key, value, options);
    },
    setItemAsync: async (key, value) => {
      await keychain.setItemAsync(key, value, options);
    },
  };
};
