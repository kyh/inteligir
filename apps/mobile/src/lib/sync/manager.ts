// ---------------------------------------------------------------------------
// The mobile composition root for @repo/core's `SyncEngine`: it binds the Expo
// platform ports (hasher, vault IO, base store, clock) + an HTTP SyncPort to the
// coordinator, and exposes `syncOnce()` + a reactive status the UI subscribes to.
//
// A fresh engine is built PER pass so it always carries the current bearer token
// (which the auth client refreshes) and reads the persisted base from disk — the
// engine keeps no cross-pass in-memory state that a rebuild would lose, so this
// is equivalent to reusing one and side-steps stale-token bugs.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { SyncEngine, type SyncOutcome } from "@repo/core/sync/engine";
import { createHttpSyncPort } from "@repo/core/sync/http-sync-port";

import { getBearerToken } from "../auth";
import { getCoordinatorUrl } from "../base-url";
import { createBaseStore } from "./base-store";
import { createFsStamp } from "./clock";
import { createExpoBaseFile } from "./expo-base-file";
import { createExpoHasher } from "./expo-hasher";
import { createExpoVaultFs } from "./expo-vault-fs";
import { createSyncIo } from "./sync-io";
import { getOrCreateVaultId } from "./vault-id";

/** The last sync pass's outcome, as the UI renders it. */
export type SyncStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "syncing" }
  | {
      readonly kind: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
      readonly at: number;
    }
  | { readonly kind: "error"; readonly message: string };

let status: SyncStatus = { kind: "idle" };
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Run one reconcile+execute pass against the coordinator. Never throws — a
 * transport/auth failure lands in the status (and the returned outcome) as
 * `{ kind: "error" }`, leaving the base manifest untouched for the next retry.
 */
export async function syncOnce(): Promise<SyncOutcome> {
  const token = getBearerToken();
  if (token === null || token === "") {
    const message = "not signed in";
    setStatus({ kind: "error", message });
    return { status: "error", message };
  }

  const vaultId = getOrCreateVaultId();
  const engine = new SyncEngine({
    vaultId,
    port: createHttpSyncPort({
      baseUrl: getCoordinatorUrl(),
      vaultId,
      token,
      hasher: createExpoHasher(),
    }),
    io: createSyncIo(createExpoVaultFs()),
    base: createBaseStore(createExpoBaseFile()),
    hash: createExpoHasher(),
    stamp: createFsStamp(),
    debounceMs: 0,
  });

  setStatus({ kind: "syncing" });
  const out = await engine.syncOnce();
  setStatus(
    out.status === "ok"
      ? {
          kind: "ok",
          pushed: out.pushed,
          pulled: out.pulled,
          deleted: out.deleted,
          conflicts: out.conflicts,
          at: Date.now(),
        }
      : { kind: "error", message: out.message },
  );
  return out;
}

/** Subscribe a React component to the sync status. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => status);
}
