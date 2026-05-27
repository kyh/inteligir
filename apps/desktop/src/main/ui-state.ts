// ---------------------------------------------------------------------------
// Persisted renderer UI state store. A thin JSON key→value map on disk so the
// renderer can save panel layout / open-panel toggles across restarts without
// each preference needing its own IPC channel.
// ---------------------------------------------------------------------------

import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { UiStateSchema, type UiState } from "@/shared/ui-state";

const DEFAULT_STATE: UiState = {};

export class UiStateManager {
  private readonly store: JsonStore<UiState>;

  constructor(storePath?: string) {
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
}

let _instance: UiStateManager | null = null;

export function getUiState(): UiStateManager {
  if (!_instance) _instance = new UiStateManager();
  return _instance;
}
