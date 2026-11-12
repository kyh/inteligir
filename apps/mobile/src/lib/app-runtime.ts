// The composition root's native half: composeRuntime bound to Better Auth's Expo client over the
// Keychain, expo-sqlite's key-value store, the file folder, the global fetch, React Native's socket
// and the OS's app state, built once for the app's life. A screen reaches the library through the hooks in
// library-hooks.ts, over TanStack Query, whose online state is the network's and whose focus is
// the app's.

import "./socket-globals";
import { expoClient } from "@better-auth/expo/client";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/client";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { addNetworkStateListener } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { defaultDatabaseDirectory } from "expo-sqlite";
import { SQLiteStorage } from "expo-sqlite/kv-store";
import { z } from "zod";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { keychainStorage } from "../auth/keychain-storage";
import { phoneAuthOver } from "../auth/phone-auth";
import type { PhoneAuth } from "../auth/phone-auth";
import { expoFileFolder } from "../files/expo-file-folder";
import { shrinkToThumbnail } from "../files/expo-thumbnail";
import type { KvStorage } from "../items/share-outbox";
import type { LoginRequest, LoginState } from "../login/login-store";
import { excludeFromBackup } from "./backup-exclusion";
import { getCloudUrl } from "./cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime, LogoutOutcome, PhoneSession } from "./compose-runtime";

// the version app.config.js read from the package. a build that carries none says 0.0.0, which
// the cloud refuses as too old rather than letting a build it cannot place through
const appVersion = (): string => Constants.expoConfig?.version ?? "0.0.0";

// a block's id on this phone: what a thought's paragraphs are named by
const newBlockId = (): string => Crypto.randomUUID();

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  bytesToHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)));

// the store's folder is taken out of the device backup with its first write; expo-sqlite types its
// default folder as any
const keptOutOfBackup = (store: SQLiteStorage): KvStorage => {
  let excluded: Promise<void> | null = null;
  const excludeOnce = async (): Promise<void> => {
    const directory = z.string().safeParse(defaultDatabaseDirectory);
    excluded ??= directory.success ? excludeFromBackup(directory.data) : Promise.resolve();
    await excluded;
  };
  return {
    getAllKeys: async () => await store.getAllKeys(),
    getItem: async (key) => await store.getItem(key),
    removeItem: async (key) => {
      await store.removeItem(key);
    },
    setItem: async (key, value) => {
      await store.setItem(key, value);
      await excludeOnce();
    },
  };
};

// Better Auth's Expo client: it keeps the session cookie in the Keychain, under keys named
// `inteligir_…`, and names the app's scheme in `expo-origin` on every call of its own, the origin
// the cloud trusts for the phone's sign-in
const phoneAuth = (cloudUrl: string): PhoneAuth =>
  phoneAuthOver(
    createAuthClient({
      baseURL: cloudUrl,
      plugins: [
        expoClient({
          scheme: PHONE_ORIGIN.replace(/:\/\/$/u, ""),
          storage: keychainStorage(SecureStore),
          storagePrefix: "inteligir",
        }),
      ],
    }),
    cloudUrl,
  );

let runtime: AppRuntime | null = null;

const build = (): AppRuntime => {
  const cloudUrl = getCloudUrl();
  const rt = composeRuntime({
    auth: phoneAuth(cloudUrl),
    build: { platform: "mobile", version: appVersion() },
    cloudUrl,
    fetch: async (request) => await globalThis.fetch(request),
    folder: expoFileFolder,
    newBlockId,
    newId: () => uuidV7(Date.now(), Crypto.getRandomBytes(16)),
    sha256Hex,
    shrinkCover: shrinkToThumbnail,
    storage: keptOutOfBackup(new SQLiteStorage("inteligir-kv")),
    WebSocket,
  });
  // the app reaches the cloud while it is in front and online, and the runtime hears each edge of
  // that once, so a wake that also brings the network back resumes once; a phone back online in
  // the background waits for the foreground
  const reach = { front: true, online: true };
  let reached = true;
  const judge = (): void => {
    const reaches = reach.front && reach.online;
    if (reaches === reached) {
      return;
    }
    reached = reaches;
    if (reaches) {
      rt.resume();
    } else {
      rt.suspend();
    }
  };
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  // `inactive` is a passing state on iOS (a pulled-down notification centre), not a departure.
  AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
    if (state === "active" || state === "background") {
      reach.front = state === "active";
      judge();
    }
  });
  onlineManager.setEventListener((setOnline) => {
    const subscription = addNetworkStateListener((network) => {
      reach.online = network.isInternetReachable ?? network.isConnected ?? false;
      setOnline(reach.online);
      judge();
    });
    return () => {
      subscription.remove();
    };
  });
  return rt;
};

export const getRuntime = (): AppRuntime => {
  runtime ??= build();
  return runtime;
};

export const ensureStarted = async (): Promise<void> => {
  await getRuntime().start();
};

export const logout = async (options?: { discardWaiting?: boolean }): Promise<LogoutOutcome> =>
  await getRuntime().logout(options);

export const login = async (request: LoginRequest): Promise<void> => {
  await getRuntime().login.login(request);
};

export const signUp = async (request: SignUpRequest): Promise<void> => {
  await getRuntime().login.signUp(request);
};

export const useSession = (): PhoneSession => {
  const { session } = getRuntime();
  return useSyncExternalStore(session.subscribe, session.get);
};

export const useLoginState = (): LoginState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
};
