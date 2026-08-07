// ---------------------------------------------------------------------------
// The user's ElevenLabs key — sealed, in their own Durable Object.
//
// The desktop kept it in an encrypted `SecretStore` under `~/.inteligir` with a
// `true` presence marker in ui-state, and the shape survives the move
// unchanged: the plaintext never crosses back over the Bridge, and Settings
// renders "a key is stored" off the marker alone.
//
// What changes is the cipher. There is no per-machine key here and no
// filesystem to protect one with, so the key rides the SAME AES-GCM seal the
// provider refresh token does (../agent/agent-crypto) — HKDF-derived from the
// deployment secret, salted with the user id, so one user's sealed blob cannot
// be replayed into another's object.
// ---------------------------------------------------------------------------

import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";
import type { UiState } from "@repo/bridge/ui-state";
import type { JsonStoreCore } from "../store/json-store-core";

import { openCredential, sealCredential } from "../agent/agent-crypto";

const SECRET_KEY = "voice/elevenlabs-key";

/** The Durable Object's synchronous key-value storage, as this module uses it.
 * `get` answers `unknown` for ../agent/provider-credentials' reason: what comes
 * back is JSON some earlier version of this code wrote. */
type VoiceSecretKv = {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  delete(key: string): boolean;
};

export type VoiceSecretDeps = {
  readonly kv: VoiceSecretKv;
  readonly uiState: JsonStoreCore<UiState>;
  readonly userId: string;
  /** The deployment secret the seal key is derived from. */
  readonly secret: string;
};

export class VoiceSecret {
  private readonly deps: VoiceSecretDeps;

  constructor(deps: VoiceSecretDeps) {
    this.deps = deps;
  }

  /**
   * Whether a key is stored right now.
   *
   * Synchronous, and it deliberately does NOT open the seal: `isTtsAvailable`
   * is asked on every Settings render and every read-aloud start, and none of
   * those callers needs the plaintext.
   */
  present(): boolean {
    return typeof this.deps.kv.get(SECRET_KEY) === "string";
  }

  /**
   * Store or clear the key. A non-empty trimmed string is sealed with a `true`
   * marker in ui-state; anything else clears both — ONE write path, so the
   * secret and the marker Settings reads can never disagree.
   */
  async set(value: string | undefined): Promise<void> {
    const secret = value?.trim() ?? "";
    if (secret === "") {
      this.deps.kv.delete(SECRET_KEY);
      this.mark(undefined);
      return;
    }
    this.deps.kv.put(SECRET_KEY, await sealCredential(this.deps.secret, this.deps.userId, secret));
    this.mark(true);
  }

  /** The plaintext key, or null when none is stored or the seal no longer
   * opens (a rotated deployment secret) — indistinguishable to every caller,
   * which is the point: both mean "connect it again". */
  async read(): Promise<string | null> {
    const sealed = this.deps.kv.get(SECRET_KEY);
    if (typeof sealed !== "string") return null;
    const plaintext = await openCredential(this.deps.secret, this.deps.userId, sealed);
    if (plaintext === null) {
      // Unreadable is worse than absent while it is still there: the marker
      // would keep Settings claiming a key that cannot be used.
      this.deps.kv.delete(SECRET_KEY);
      this.mark(undefined);
      return null;
    }
    return plaintext;
  }

  private mark(value: true | undefined): void {
    this.deps.uiState.update((current) => {
      if (value === undefined) {
        if (!(ELEVENLABS_API_KEY_UI_STATE in current)) return current;
        const next = { ...current };
        delete next[ELEVENLABS_API_KEY_UI_STATE];
        return next;
      }
      return { ...current, [ELEVENLABS_API_KEY_UI_STATE]: value };
    });
  }
}
