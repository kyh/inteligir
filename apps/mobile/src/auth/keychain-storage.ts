import type { ExpoClientStorage } from "@better-auth/expo/client";
import type * as SecureStore from "expo-secure-store";

export type Keychain = Pick<
  typeof SecureStore,
  "WHEN_UNLOCKED_THIS_DEVICE_ONLY" | "getItem" | "getItemAsync" | "setItem" | "setItemAsync"
>;

export const keychainStorage = (keychain: Keychain) => {
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
  } satisfies ExpoClientStorage;
};
