// ---------------------------------------------------------------------------
// The user's durable host state, as JsonStores over the Durable Object's KV.
//
// TypeBox validation on read and write, quarantine-and-reset on drift, bound to
// `ctx.storage.kv` through the DO adapter (../store/do-store-adapter). The KV
// API is SYNCHRONOUS, which is what makes the engine usable at all: its
// read-modify-write completes in one JS turn, so no other caller can interleave
// on an update.
// ---------------------------------------------------------------------------

import { UiStateSchema, type UiState } from "@repo/bridge/ui-state";
import { createDoStoreAdapter, type SyncKv } from "../store/do-store-adapter";
import { JsonStoreCore } from "../store/json-store-core";

/** Storage keys. Opaque to the engine, which only ever suffixes them when it
 * quarantines a value. */
const UI_STATE_KEY = "ui-state";

// Unversioned, and safely: UiStateSchema is a fully permissive record, so a
// schema-mismatch wipe cannot occur.
const DEFAULT_UI_STATE: UiState = {};

export type CloudStores = {
  readonly uiState: JsonStoreCore<UiState>;
};

export function createCloudStores(kv: SyncKv): CloudStores {
  const adapter = createDoStoreAdapter(kv);
  return {
    uiState: new JsonStoreCore(adapter, UI_STATE_KEY, UiStateSchema, DEFAULT_UI_STATE),
  };
}
