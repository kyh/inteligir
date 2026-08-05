// ---------------------------------------------------------------------------
// The mobile composition root for @repo/notes's `SyncEngine`: it binds the Expo
// platform ports (hasher, vault IO, base store, clock) + an HTTP SyncPort to
// the coordinator, and exposes `syncOnce()` + `scheduleSync()` + a reactive
// status the UI subscribes to.
//
// ONE engine lives as long as its credential: it is rebuilt whenever that
// changes (a re-pair, a token refresh, a sign-out), so no pass ever carries a
// stale credential or a stale vault, while the engine's cross-pass machinery —
// debounce, pass serialization, hash cache — stays warm between passes. The
// credential itself is asked for per request (a device assertion expires in
// minutes), which is why the engine keys off its IDENTITY and not its bytes.
//
// Switching vaults needs no local cleanup: the engine's stored base manifest is
// scoped by vaultId, so a pass against a newly enrolled vault reads no anchor
// at all and plans pushes only.
//
// The engine's stream subscription (`start()`) is deliberately NOT used here:
// the SSE stream needs `expo/fetch` and lives in realtime-manager.ts, which
// funnels changes into `scheduleSync()`.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { createJsonFileBaseStore } from "@repo/notes/sync/base-store";
import { SyncEngine, type SyncOutcome, type SyncPassOptions } from "@repo/notes/sync/engine";
import { createHttpSyncPort } from "@repo/notes/sync/http-sync-port";
import { statusFromOutcome, type SyncStatus } from "@repo/notes/sync/status";

import { createExternalStore } from "../external-store";
import { createFsStamp } from "./clock";
import { currentCredential, NO_CREDENTIAL_MESSAGE, type SyncCredential } from "./credential";
import { createExpoBaseFile } from "./expo-base-file";
import { createExpoBlobStore } from "./expo-blob-store";
import { createExpoHasher } from "./expo-hasher";
import { createExpoVaultFs } from "./expo-vault-fs";
import { createSyncIo } from "./sync-io";

const statusStore = createExternalStore<SyncStatus>({ phase: "idle" });

/** A SyncEngine whose every pass request flips the reactive status to
 * `syncing`. The engine's own debounced passes (`scheduleSync`) call
 * `this.syncOnce()`, so virtual dispatch routes them through this override —
 * realtime-triggered passes surface exactly like explicit ones; `onOutcome`
 * (below) lands the result status either way. */
class StatusReportingSyncEngine extends SyncEngine {
  override syncOnce(opts?: SyncPassOptions): Promise<SyncOutcome> {
    statusStore.set({ phase: "syncing" });
    return super.syncOnce(opts);
  }
}

let live: { readonly id: string; readonly engine: SyncEngine } | null = null;

/** The engine for `credential` — reused while its identity holds, rebuilt (and
 * the old one stopped, cancelling its pending debounce) when it changes. */
function engineFor(credential: SyncCredential): SyncEngine {
  if (live !== null && live.id === credential.id) return live.engine;
  live?.engine.stop();
  const { vaultId } = credential;
  const engine = new StatusReportingSyncEngine({
    vaultId,
    port: createHttpSyncPort({
      baseUrl: credential.baseUrl,
      vaultId,
      getToken: credential.getToken,
      hasher: createExpoHasher(),
    }),
    io: createSyncIo(createExpoVaultFs()),
    base: createJsonFileBaseStore(createExpoBaseFile()),
    blobs: createExpoBlobStore(),
    hash: createExpoHasher(),
    stamp: createFsStamp(),
    onOutcome: (outcome) => statusStore.set(statusFromOutcome(outcome)),
  });
  live = { id: credential.id, engine };
  return engine;
}

/**
 * Stop the live engine and drop it, cancelling any pending debounced pass. Call
 * it BEFORE giving up a credential (disconnecting a vault, signing out) — a
 * debounce armed under the old credential would otherwise wake up and try to
 * sign a pass with a key that no longer exists.
 */
export function stopSync(): void {
  live?.engine.stop();
  live = null;
}

/**
 * Run one reconcile+execute pass against the coordinator. Never throws — a
 * transport/auth failure lands in the status (and the returned outcome) as
 * `{ phase: "error" }`, leaving the base manifest untouched for the next retry.
 *
 * `opts.confirmDeletions` releases a held pass and belongs to the vault
 * screen's confirmation alone. Every AUTOMATIC caller here — the realtime
 * manager's foreground kick and SSE trigger, pull-to-refresh, the after-save
 * pass — passes nothing, because a hold nobody is watching may only ever be
 * reported.
 */
export async function syncOnce(opts?: SyncPassOptions): Promise<SyncOutcome> {
  const credential = currentCredential();
  if (credential === null) {
    stopSync();
    statusStore.set({ phase: "error", message: NO_CREDENTIAL_MESSAGE });
    return { status: "error", message: NO_CREDENTIAL_MESSAGE };
  }
  return engineFor(credential).syncOnce(opts);
}

/** Kick one engine-debounced pass (the realtime stream's change trigger).
 * Bursts coalesce in the engine; passes never overlap (its serialized queue). */
export function scheduleSync(): void {
  const credential = currentCredential();
  if (credential === null) {
    stopSync();
    statusStore.set({ phase: "error", message: NO_CREDENTIAL_MESSAGE });
    return;
  }
  engineFor(credential).scheduleSync();
}

/** Subscribe a React component to the sync status. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(statusStore.subscribe, statusStore.get);
}
