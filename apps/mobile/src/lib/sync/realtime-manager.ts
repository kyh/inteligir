// ---------------------------------------------------------------------------
// Realtime sync wiring — binds the pure ./realtime supervisor to the platform:
//
//   - the stream is @repo/domain's HttpSyncPort SSE subscription, driven through
//     `expo/fetch` (Expo's WinterCG fetch): React Native's built-in fetch
//     buffers whole responses (`res.body` is unusable for SSE), while
//     expo/fetch streams — so ONLY the subscription injects it; the engine's
//     own passes keep the global fetch.
//   - a change kicks ./manager's `scheduleSync` (the engine's debounced,
//     serialized pass), so status keeps flowing through `useSyncStatus`.
//   - `useRealtimeSync()` (mounted by the signed-in vault screen) holds the
//     subscription while the app is foregrounded: active → syncOnce + (re)open
//     the stream; background → close it. Unmount (sign-out) also closes it.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { AppState } from "react-native";
import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";

import { createHttpSyncPort, type FetchFn } from "@repo/domain/sync/http-sync-port";
import { timeoutSchedule } from "@repo/bridge/backoff";

import { subscribeAppForeground } from "../app-lifecycle";
import { getBearerToken } from "../auth";
import { getCoordinatorUrl } from "../base-url";
import { createExpoHasher } from "./expo-hasher";
import { scheduleSync, syncOnce } from "./manager";
import { createRealtimeSync, type StreamHandlers } from "./realtime";
import { getOrCreateVaultId } from "./vault-id";

/** `expo/fetch` narrowed to the `FetchFn` surface HttpSyncPort calls (a URL
 * string + method/headers/signal init) — no `Request` inputs ever reach it. */
const streamingFetch: FetchFn = (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? input : input.url;
  // Built field-by-field: exactOptionalPropertyTypes forbids `field: undefined`.
  const request: FetchRequestInit = {};
  if (init?.method !== undefined) request.method = init.method;
  if (init?.headers !== undefined) request.headers = init.headers;
  if (init?.signal !== undefined) request.signal = init.signal;
  return expoFetch(url, request);
};

/** Open one SSE change stream carrying the CURRENT bearer token (a fresh port
 * per open, like ./manager's engine-per-token, so reconnects never reuse a
 * stale token). */
function openStream(handlers: StreamHandlers): () => void {
  const token = getBearerToken();
  if (token === null || token === "") {
    // Signed out under us — report an end asynchronously so the supervisor's
    // backoff owns the retry cadence (the screen unmount stops us for real).
    const handle = setTimeout(handlers.onEnd, 0);
    return () => clearTimeout(handle);
  }
  const vaultId = getOrCreateVaultId();
  const port = createHttpSyncPort({
    baseUrl: getCoordinatorUrl(),
    vaultId,
    token,
    fetchImpl: streamingFetch,
    // Subscribe-only port — no getFile ever runs here, but the hasher is a
    // required part of the contract (getFile verifies bytes against headers).
    hasher: createExpoHasher(),
  });
  return port.subscribe(() => handlers.onChange(), handlers.onEnd);
}

const supervisor = createRealtimeSync({
  openStream,
  scheduleSync,
  schedule: timeoutSchedule,
});

/**
 * Keep sync live while the app is foregrounded. Mount from the signed-in vault
 * screen only — mounting implies a session, unmounting (sign-out) closes the
 * stream. Manual triggers (button, pull-to-refresh, after-save) are untouched.
 */
export function useRealtimeSync(): void {
  useEffect(() => {
    const onActive = (): void => {
      void syncOnce();
      supervisor.start();
    };
    if (AppState.currentState === "active") onActive();
    const unsubscribe = subscribeAppForeground((state) => {
      if (state === "active") onActive();
      else supervisor.stop();
    });
    return () => {
      unsubscribe();
      supervisor.stop();
    };
  }, []);
}
