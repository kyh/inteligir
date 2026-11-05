// The composition root's native half: composeRuntime bound to the Keychain, expo-sqlite, the file
// folders, the global fetch, React Native's socket, the headless page's merge and the OS's app
// state, built once for the app's life. A screen reaches the library through the hooks in
// library-hooks.ts, and what only the cell answers through TanStack Query, whose online state is
// the network's and whose focus is the app's.

import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { addNetworkStateListener } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { hexFromBytes } from "@repo/contract/cloud/bytes";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { createKeychainCredentials } from "../credential/secure-store-credential";
import { createHeadlessPageHost } from "../editor/headless-page-host";
import type { HeadlessPageHost } from "../editor/headless-page-host";
import { editorPageSource } from "../editor/page-source";
import type { PageSource } from "../editor/page-source";
import { createExpoFileFolders } from "../files/expo-file-folders";
import { shrinkToThumbnail } from "../files/expo-thumbnail";
import { createPageFetch } from "../items/page-fetch";
import type { PageFetch } from "../items/page-fetch";
import type { LoginRequest, LoginState } from "../login/login-store";
import { excludeFromBackup } from "./backup-exclusion";
import { getCloudUrl } from "./cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime, LogoutOutcome, PhoneSession } from "./compose-runtime";
import { openExpoReplicaSql } from "./expo-replica-sql";

// the version app.config.js read from the package. a build that carries none says 0.0.0, which
// the cloud refuses as too old rather than letting a build it cannot place through
const appVersion = (): string => Constants.expoConfig?.version ?? "0.0.0";

// a block's id on this phone: what a thought's paragraphs are named by
export const newBlockId = (): string => Crypto.randomUUID();

// one per load of an item's page, and of the headless page
export const mintBridgeNonce = (): string => hexFromBytes(Crypto.getRandomBytes(16));

let headless: { host: HeadlessPageHost; source: PageSource } | null | undefined;

// the page in its headless mode, which HeadlessPage mounts; null for a build made without the page
export const headlessPage = (): { host: HeadlessPageHost; source: PageSource } | null => {
  if (headless === undefined) {
    const source = editorPageSource();
    headless =
      source === null
        ? null
        : {
            host: createHeadlessPageHost({ mintNonce: mintBridgeNonce, pageUrl: source.uri }),
            source,
          };
  }
  return headless;
};

// a shared page is asked for as Safari on the phone would ask, naming the app after it
const userAgent = (): string =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 inteligir/${appVersion()}`;

// the phone's own language first, its bare language after
const acceptLanguage = (): string => {
  const { locale } = Intl.DateTimeFormat().resolvedOptions();
  const [language = "en"] = locale.split("-");
  return locale === language ? locale : `${locale},${language};q=0.9`;
};

// a page the share sheet reads: fetched by the phone itself, its redirects judged hop by hop
export const sharedPageFetch: PageFetch = createPageFetch(globalThis.fetch, {
  acceptLanguage: acceptLanguage(),
  userAgent: userAgent(),
});

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  hexFromBytes(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)));

// what only the cell answers, asked with TanStack Query: it pauses with no connection, and asks
// again as the app comes back to the front
export const queryClient = new QueryClient();

let runtime: AppRuntime | null = null;

const build = (): AppRuntime => {
  const rt = composeRuntime({
    build: { platform: "mobile", version: appVersion() },
    clock: {
      after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      now: () => Date.now(),
    },
    cloudUrl: getCloudUrl(),
    credentials: createKeychainCredentials(SecureStore),
    // React Native's WebSocket: the engine opens it with the ticket a `/v1` call minted, in the
    // query string, as every client does, never a header
    dial: (url) => new WebSocket(url),
    fetch: async (request) => await globalThis.fetch(request),
    folders: createExpoFileFolders(excludeFromBackup),
    merge: async (sides) => {
      const page = headlessPage();
      if (page === null) {
        throw new Error("This build has no page to merge a change with.");
      }
      return await page.host.merge(sides);
    },
    newId: () => uuidV7(Date.now(), Crypto.getRandomBytes(16)),
    openSql: async () => await openExpoReplicaSql("inteligir.db"),
    sha256Hex,
    shrinkCover: shrinkToThumbnail,
  });
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  // `inactive` is a passing state on iOS (a pulled-down notification centre), not a departure.
  AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
    if (state === "active") {
      rt.resume();
    } else if (state === "background") {
      rt.suspend();
    }
  });
  // a phone back online sends what it queued offline without waiting for its retry; in the
  // background it waits for the foreground, which dials the socket too
  let online = true;
  onlineManager.setEventListener((setOnline) => {
    const subscription = addNetworkStateListener((network) => {
      const reachable = network.isInternetReachable ?? network.isConnected ?? false;
      setOnline(reachable);
      if (reachable && !online && AppState.currentState === "active") {
        rt.resume();
      }
      online = reachable;
    });
    return () => {
      subscription.remove();
    };
  });
  return rt;
};

const getRuntime = (): AppRuntime => {
  runtime ??= build();
  return runtime;
};

export const ensureStarted = async (): Promise<void> => {
  await getRuntime().start();
};

export const logout = async (options?: { discardUnsent?: boolean }): Promise<LogoutOutcome> =>
  await getRuntime().logout(options);

export const login = async (request: LoginRequest): Promise<void> => {
  await getRuntime().login.login(request);
};

export const useSession = (): PhoneSession => {
  const { session } = getRuntime();
  return useSyncExternalStore(session.subscribe, session.get);
};

export const useLoginState = (): LoginState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
};
