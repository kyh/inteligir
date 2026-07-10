// ---------------------------------------------------------------------------
// The production EnvironmentStore: the pure store over expo-secure-store, the
// same keychain the auth client uses (see ../auth.ts) — the device token is a
// credential and never touches AsyncStorage. Tests never import this module;
// they exercise the pure factory with an in-memory port.
// ---------------------------------------------------------------------------

import * as SecureStore from "expo-secure-store";

import { createEnvironmentStore, type StringStorePort } from "./environment-store";

const secureStringStore: StringStorePort = {
  get: (key) => SecureStore.getItem(key),
  set: (key, value) => {
    SecureStore.setItem(key, value);
  },
  delete: (key) => {
    void SecureStore.deleteItemAsync(key);
  },
};

/** The app-wide saved-environment store (single instance, secure storage). */
export const hostEnvironmentStore = createEnvironmentStore(secureStringStore);
