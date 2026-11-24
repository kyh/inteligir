import "core-js/actual/array/to-sorted";
import { expoClient } from "@better-auth/expo/client";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/client";
import { AppState, Image } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { addNetworkStateListener } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { defaultDatabaseDirectory } from "expo-sqlite";
import { SQLiteStorage } from "expo-sqlite/kv-store";
import { z } from "zod";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { keychainStorage } from "../auth/keychain-storage";
import { phoneAuthOver } from "../auth/phone-auth";
import { expoFileFolder } from "../files/expo-file-folder";
import type { FileCachePorts } from "../files/file-cache";
import type { KvStorage } from "@repo/client/waiting-saves";
import { excludeFromBackup } from "../lib/backup-exclusion";
import { getCloudUrl } from "../lib/cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime } from "./compose-runtime";

const appVersion = () => Constants.expoConfig?.version ?? "0.0.0";

const newBlockId = () => Crypto.randomUUID();

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  bytesToHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)));

const measurePicture: FileCachePorts["measure"] = async (uri) => {
  const size = await Image.getSize(uri);

  return size.width > 0 && size.height > 0 ? size : null;
};

const keptOutOfBackup = (store: SQLiteStorage) => {
  let excluded: Promise<void> | null = null;

  const excludeOnce = async () => {
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
  } satisfies KvStorage;
};

const phoneAuth = (cloudUrl: string) =>
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

const build = () => {
  const cloudUrl = getCloudUrl();

  const rt = composeRuntime({
    auth: phoneAuth(cloudUrl),
    build: { platform: "mobile", version: appVersion() },
    cloudUrl,
    fetch: async (request) => await globalThis.fetch(request),
    folder: expoFileFolder,
    measurePicture,
    newBlockId,
    newId: () => uuidV7(Date.now(), Crypto.getRandomBytes(16)),
    sha256Hex,
    storage: keptOutOfBackup(new SQLiteStorage("inteligir-kv")),
  });

  AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");

    if (state === "active" || state === "background") {
      rt.setReach({ front: state === "active" });
    }
  });
  onlineManager.setEventListener((setOnline) => {
    const subscription = addNetworkStateListener((network) => {
      setOnline(network.isInternetReachable ?? network.isConnected ?? false);
    });

    return () => {
      subscription.remove();
    };
  });
  onlineManager.subscribe((online) => {
    rt.setReach({ online });
  });

  return rt;
};

export const appRuntime = () => {
  runtime ??= build();

  return runtime;
};
