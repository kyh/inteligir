// ---------------------------------------------------------------------------
// Main-process secret store — a small key→credential map persisted at
// ~/.inteligir/secrets.json. Values are encrypted at rest with Electron
// safeStorage (OS keychain-backed) when available, with a documented
// plaintext fallback (e.g. Linux without a keyring); either way the file is
// written 0o600 and the ~/.inteligir dir is kept 0o700 by the store layer.
//
// Scope: credentials that main-process features read directly (currently the
// ElevenLabs TTS key, routed here by UiStateManager). This is distinct from
// the Extensions panel's secrets section, which is backed by the executor
// daemon's own store under ~/.inteligir/executor, and from pi's provider
// OAuth tokens in auth.json (pi-internal, already chmod 0o600 upstream).
// ---------------------------------------------------------------------------

import { safeStorage } from "electron";
import { type Static, Type } from "@sinclair/typebox";

import { JsonStore, inteligirPath, type FsAdapter } from "@/main/lib/json-store";

const SecretEntrySchema = Type.Union([
  // Encrypted via Electron safeStorage; `data` is the base64 ciphertext.
  Type.Object(
    { kind: Type.Literal("safe-storage"), data: Type.String() },
    { additionalProperties: false },
  ),
  // safeStorage unavailable at write time (no OS keyring). The 0o600 file
  // mode is the only protection — recorded explicitly so a later read knows
  // not to attempt decryption.
  Type.Object(
    { kind: Type.Literal("plaintext"), data: Type.String() },
    { additionalProperties: false },
  ),
]);

type SecretEntry = Static<typeof SecretEntrySchema>;

const SecretsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    secrets: Type.Record(Type.String(), SecretEntrySchema),
  },
  { additionalProperties: false },
);

type SecretsFile = Static<typeof SecretsFileSchema>;

const DEFAULT_SECRETS: SecretsFile = { version: 1, secrets: {} };

/** Encryption seam — production uses Electron safeStorage; tests inject. */
export type SecretCipher = {
  isAvailable: () => boolean;
  /** Plaintext → base64 ciphertext. */
  encrypt: (plaintext: string) => string;
  /** Base64 ciphertext → plaintext. Throws when the payload can't be read
   * (keychain reset, different machine). */
  decrypt: (data: string) => string;
};

const safeStorageCipher: SecretCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString("base64"),
  decrypt: (data) => safeStorage.decryptString(Buffer.from(data, "base64")),
};

export type SecretStoreOptions = {
  storePath?: string;
  cipher?: SecretCipher;
  fs?: FsAdapter;
};

export class SecretStore {
  private readonly store: JsonStore<SecretsFile>;
  private readonly cipher: SecretCipher;

  constructor(options: SecretStoreOptions = {}) {
    this.cipher = options.cipher ?? safeStorageCipher;
    this.store = new JsonStore<SecretsFile>(
      options.storePath ?? inteligirPath("secrets.json"),
      SecretsFileSchema,
      DEFAULT_SECRETS,
      {
        ...(options.fs ? { fs: options.fs } : {}),
        // Credential file: owner read/write only.
        mode: 0o600,
        versioning: {
          current: 1,
          fromLegacy: () => {
            throw new Error("secrets.json was never written without a version field");
          },
        },
      },
    );
  }

  set(key: string, plaintext: string): void {
    const entry: SecretEntry = this.cipher.isAvailable()
      ? { kind: "safe-storage", data: this.cipher.encrypt(plaintext) }
      : { kind: "plaintext", data: plaintext };
    this.store.update((current) => ({
      ...current,
      secrets: { ...current.secrets, [key]: entry },
    }));
  }

  /** Decrypted secret, or null when missing or undecryptable (keychain
   * reset). An undecryptable entry reads as absent so the owning feature
   * reports "not configured" instead of failing with garbage. */
  get(key: string): string | null {
    const entry = this.store.read().secrets[key];
    if (!entry) return null;
    if (entry.kind === "plaintext") return entry.data;
    try {
      return this.cipher.decrypt(entry.data);
    } catch (err) {
      console.error(`[secrets] failed to decrypt '${key}' (keychain changed?):`, err);
      return null;
    }
  }

  has(key: string): boolean {
    return this.store.read().secrets[key] !== undefined;
  }

  delete(key: string): void {
    this.store.update((current) => {
      if (!(key in current.secrets)) return current;
      const { [key]: _discarded, ...secrets } = current.secrets;
      return { ...current, secrets };
    });
  }

  /** Disable writes on the underlying store. Called by resetSecretStore
   * during logout teardown so a stale reference cannot resurrect
   * secrets.json after the AGENT_DIR rm. */
  closeStore(): void {
    this.store.close();
  }
}

let instance: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (!instance) instance = new SecretStore();
  return instance;
}

/** Logout teardown: close the store (one-way kill switch on writes) and drop
 * the singleton so a warm cache can't resurrect secrets.json — the previous
 * user's credentials — after the AGENT_DIR rm. */
export function resetSecretStore(): void {
  if (instance) instance.closeStore();
  instance = null;
}
