// ---------------------------------------------------------------------------
// Persisted renderer UI state store. A thin JSON key→value map on disk so the
// renderer can save panel layout / open-panel toggles across restarts without
// each preference needing its own IPC channel.
//
// Secret-valued keys (SECRET_KEYS) are the exception: their plaintext never
// lands in ui-state.json. Writes through the existing setUiState channel are
// routed into the encrypted SecretStore and only a `true` presence marker is
// kept here, so getUiState stays the renderer's way to ask "is it set"
// without a dedicated IPC channel per credential.
// ---------------------------------------------------------------------------

import { JsonStore, inteligirPath } from "./lib/json-store";
import { getSecretStore } from "./secrets";
import { UiStateSchema, type UiState } from "@repo/features/ui-state";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/features/voice";

const DEFAULT_STATE: UiState = {};

// ui-state keys whose values are credentials. Stored in the SecretStore;
// ui-state.json carries only `true` while a secret exists.
const SECRET_KEYS: ReadonlySet<string> = new Set([ELEVENLABS_API_KEY_UI_STATE]);

/** The slice of SecretStore the manager needs — injection seam for tests. */
type SecretSink = {
  set: (key: string, value: string) => void;
  get: (key: string) => string | null;
  delete: (key: string) => void;
};

export class UiStateManager {
  private readonly store: JsonStore<UiState>;
  private readonly secrets: SecretSink;

  constructor(storePath?: string, secrets?: SecretSink) {
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
    this.secrets = secrets ?? getSecretStore();
  }

  getAll(): UiState {
    return this.store.read();
  }

  set(key: string, value: unknown): UiState {
    if (SECRET_KEYS.has(key)) {
      const secret = typeof value === "string" ? value.trim() : "";
      if (secret.length > 0) {
        this.secrets.set(key, secret);
        return this.writeValue(key, true); // presence marker; plaintext stays out
      }
      // Anything else (undefined, empty string, wrong type) clears the secret.
      this.secrets.delete(key);
      return this.writeValue(key, undefined);
    }
    return this.writeValue(key, value);
  }

  /** Decrypted secret for a SECRET_KEYS entry; null for any other key. */
  readSecret(key: string): string | null {
    return SECRET_KEYS.has(key) ? this.secrets.get(key) : null;
  }

  private writeValue(key: string, value: unknown): UiState {
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
