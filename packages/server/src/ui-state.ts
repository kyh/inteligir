// ---------------------------------------------------------------------------
// Persisted renderer UI state store. A thin JSON key→value map on disk so the
// renderer can save panel layout / open-panel toggles across restarts without
// each preference needing its own IPC channel.
//
// Deliberately GENERIC: no per-feature key knowledge lives here. Credentials
// never do either — a feature that stores a secret writes the encrypted
// SecretStore itself and keeps only a `true` presence marker in ui-state.
// ---------------------------------------------------------------------------

import { JsonStore, inteligirPath } from "@repo/storage/json-store";
import { UiStateSchema, type UiState } from "@repo/bridge/ui-state";

const DEFAULT_STATE: UiState = {};

export class UiStateManager {
  private readonly store: JsonStore<UiState>;

  constructor(storePath?: string) {
    // Deliberately unversioned: UiStateSchema is a fully permissive
    // Record<string, unknown>, so a schema-mismatch wipe cannot occur — only
    // truly unparseable JSON resets it, and the contents (panel layout, open
    // -panel toggles) are cosmetic and re-creatable. If this store ever grows
    // a strict schema, give it `versioning` like the other stores.
    this.store = new JsonStore(
      storePath ?? inteligirPath("ui-state.json"),
      UiStateSchema,
      DEFAULT_STATE,
    );
  }

  getAll(): UiState {
    return this.store.read();
  }

  set(key: string, value: unknown): UiState {
    return this.store.update((current) => {
      // Writing `undefined` removes the key — JSON.stringify would drop it
      // anyway, so model removal explicitly to keep the file tidy.
      if (value === undefined) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: value };
    });
  }

  /** Disable writes on the underlying store. Called by resetUiState during
   * logout teardown so a stale reference cannot resurrect ui-state.json
   * after the AGENT_DIR rm. */
  closeStore(): void {
    this.store.close();
  }
}

let instance: UiStateManager | null = null;

export function getUiState(): UiStateManager {
  if (!instance) instance = new UiStateManager();
  return instance;
}

/** Logout teardown: close the store (one-way kill switch on writes) and drop
 * the singleton so a warm cache can't resurrect ui-state.json after the
 * AGENT_DIR rm. The next getUiState() builds a fresh instance. */
export function resetUiState(): void {
  if (instance) instance.closeStore();
  instance = null;
}
