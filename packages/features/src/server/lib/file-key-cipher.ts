// ---------------------------------------------------------------------------
// SecretCipher backed by a random key file — the server-mode counterpart to
// Electron's safeStorage (no OS keychain in a plain node process).
// AES-256-GCM; ciphertext format base64(iv[12] ‖ tag[16] ‖ ct).
//
// Threat-model honesty: the key sits beside the ciphertext (both under the
// user's home), so this only defeats single-file exfiltration of
// secrets.json (backup, paste), not an attacker with home-dir read. That's
// strictly better than the documented plaintext fallback and worse than a
// keychain — acceptable for a local single-user server. If the key file
// can't be created/read, isAvailable() is false and SecretStore falls back
// to its plaintext entry kind, unchanged.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { SecretCipher } from "../platform";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function createFileKeyCipher(keyPath: string): SecretCipher {
  let key: Buffer | null = null;

  /** Read the key, lazily creating it (0600) on first use. Throws when the
   * file exists but is unusable — silently regenerating would orphan every
   * existing ciphertext. */
  function loadKey(): Buffer {
    if (key) return key;
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath);
      if (existing.length !== KEY_BYTES) {
        throw new Error(`secret key file ${keyPath} is corrupt (${existing.length} bytes)`);
      }
      key = existing;
      return key;
    }
    const fresh = randomBytes(KEY_BYTES);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, fresh, { mode: 0o600 });
    key = fresh;
    return key;
  }

  return {
    kind: "file-key",
    isAvailable: () => {
      try {
        loadKey();
        return true;
      } catch (err) {
        console.error(`[secrets] file-key cipher unavailable (${keyPath}):`, err);
        return false;
      }
    },
    encrypt: (plaintext) => {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
    },
    decrypt: (data) => {
      const raw = Buffer.from(data, "base64");
      if (raw.length < IV_BYTES + TAG_BYTES) {
        throw new Error("ciphertext too short for iv + auth tag");
      }
      const decipher = createDecipheriv("aes-256-gcm", loadKey(), raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
