// ---------------------------------------------------------------------------
// The user's durable host state, as JsonStores over the Durable Object's KV.
//
// Same engine as the desktop's `~/.inteligir/*.json` stores — TypeBox
// validation on read and write, quarantine-and-reset on drift — bound to
// `ctx.storage.kv` instead of a filesystem through the DO adapter. The KV API
// is SYNCHRONOUS, which is what makes the engine usable at all: its
// read-modify-write completes in one JS turn, so no other caller can interleave
// on an update.
// ---------------------------------------------------------------------------

import type { NotificationSettings } from "@repo/bridge/ipc-registry";
import { UiStateSchema, type UiState } from "@repo/bridge/ui-state";
import { createDoStoreAdapter, type SyncKv } from "@repo/storage/do-store-adapter";
import { JsonStoreCore } from "@repo/storage/json-store-core";
import { Type } from "@sinclair/typebox";

/** Storage keys. Opaque to the engine, which only ever suffixes them when it
 * quarantines a value. */
const UI_STATE_KEY = "ui-state";
const NOTIFICATIONS_KEY = "notifications";

// Unversioned, both for the reason the desktop stores are: UiStateSchema is a
// fully permissive record, so a schema-mismatch wipe cannot occur, and the
// notification setting is one boolean whose reset to the default is harmless.
const NotificationSettingsSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);

const DEFAULT_UI_STATE: UiState = {};
const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: true };

export type CloudStores = {
  readonly uiState: JsonStoreCore<UiState>;
  readonly notifications: JsonStoreCore<NotificationSettings>;
};

export function createCloudStores(kv: SyncKv): CloudStores {
  const adapter = createDoStoreAdapter(kv);
  return {
    uiState: new JsonStoreCore(adapter, UI_STATE_KEY, UiStateSchema, DEFAULT_UI_STATE),
    notifications: new JsonStoreCore(
      adapter,
      NOTIFICATIONS_KEY,
      NotificationSettingsSchema,
      DEFAULT_NOTIFICATIONS,
    ),
  };
}
