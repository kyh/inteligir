// ---------------------------------------------------------------------------
// The mobile composition root for @repo/core's `SyncEngine`: it binds the Expo
// platform ports (hasher, vault IO, base store, clock) + an HTTP SyncPort to
// the coordinator, and exposes `syncOnce()` + `scheduleSync()` + a reactive
// status the UI subscribes to.
//
// ONE engine lives as long as its bearer token: it is rebuilt whenever the
// token changes (the auth client refreshes it), so no pass ever carries a
// stale credential, while the engine's cross-pass machinery — debounce, pass
// serialization, hash cache — stays warm between passes. The engine's stream
// subscription (`start()`) is deliberately NOT used here: the SSE stream
// needs `expo/fetch` and lives in realtime-manager.ts, which funnels changes
// into `scheduleSync()`.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { createJsonFileBaseStore } from "@repo/core/sync/base-store";
import { SyncEngine, type SyncOutcome } from "@repo/core/sync/engine";
import { createHttpSyncPort } from "@repo/core/sync/http-sync-port";
import { statusFromOutcome, type SyncStatus } from "@repo/core/sync/status";

import { getBearerToken } from "../auth";
import { getCoordinatorUrl } from "../base-url";
import { createExternalStore } from "../external-store";
import { createFsStamp } from "./clock";
import { createExpoBaseFile } from "./expo-base-file";
import { createExpoBlobStore } from "./expo-blob-store";
import { createExpoHasher } from "./expo-hasher";
import { createExpoVaultFs } from "./expo-vault-fs";
import { createSyncIo } from "./sync-io";
import { getOrCreateVaultId } from "./vault-id";

const statusStore = createExternalStore<SyncStatus>({ phase: "idle" });

/** A SyncEngine whose every pass request flips the reactive status to
 * `syncing`. The engine's own debounced passes (`scheduleSync`) call
 * `this.syncOnce()`, so virtual dispatch routes them through this override —
 * realtime-triggered passes surface exactly like explicit ones; `onOutcome`
 * (below) lands the result status either way. */
class StatusReportingSyncEngine extends SyncEngine {
  override syncOnce(): Promise<SyncOutcome> {
    statusStore.set({ phase: "syncing" });
    return super.syncOnce();
  }
}

let live: { readonly token: string; readonly engine: SyncEngine } | null = null;

/** The engine for `token` — reused while the token holds, rebuilt (and the
 * old one stopped, cancelling its pending debounce) when it changes. */
function engineFor(token: string): SyncEngine {
  if (live !== null && live.token === token) return live.engine;
  live?.engine.stop();
  const vaultId = getOrCreateVaultId();
  const engine = new StatusReportingSyncEngine({
    vaultId,
    port: createHttpSyncPort({
      baseUrl: getCoordinatorUrl(),
      vaultId,
      token,
      hasher: createExpoHasher(),
    }),
    io: createSyncIo(createExpoVaultFs()),
    base: createJsonFileBaseStore(createExpoBaseFile()),
    blobs: createExpoBlobStore(),
    hash: createExpoHasher(),
    stamp: createFsStamp(),
    onOutcome: (outcome) => statusStore.set(statusFromOutcome(outcome)),
  });
  live = { token, engine };
  return engine;
}

function currentToken(): string | null {
  const token = getBearerToken();
  return token === null || token === "" ? null : token;
}

/**
 * Run one reconcile+execute pass against the coordinator. Never throws — a
 * transport/auth failure lands in the status (and the returned outcome) as
 * `{ phase: "error" }`, leaving the base manifest untouched for the next retry.
 */
export async function syncOnce(): Promise<SyncOutcome> {
  const token = currentToken();
  if (token === null) {
    const message = "not signed in";
    statusStore.set({ phase: "error", message });
    return { status: "error", message };
  }
  return engineFor(token).syncOnce();
}

/** Kick one engine-debounced pass (the realtime stream's change trigger).
 * Bursts coalesce in the engine; passes never overlap (its serialized queue). */
export function scheduleSync(): void {
  const token = currentToken();
  if (token === null) {
    statusStore.set({ phase: "error", message: "not signed in" });
    return;
  }
  engineFor(token).scheduleSync();
}

/** Subscribe a React component to the sync status. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(statusStore.subscribe, statusStore.get);
}
