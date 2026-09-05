// not config.json: that is read once at boot and never written by the app; this is read per
// paste, so a Settings or CLI change reaches the next paste without a reboot.
// malformed bytes are an error, not a default — the next write would erase them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { attachmentLocationSchema } from "@repo/api/local/vault/vault-schema";
import { stagedWriteFileSync } from "../staged-write";

const VAULT_PREFS_FILE = "vault-prefs.json";

const storeFileSchema = z.object({ attachments: attachmentLocationSchema.optional() }).strict();

export type VaultPrefs = z.infer<typeof storeFileSchema>;

export class VaultPrefsStoreError extends Error {}

export class VaultPrefsStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, VAULT_PREFS_FILE);
  }

  read(): VaultPrefs {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new VaultPrefsStoreError(
        `${this.path} is not valid JSON — fix or remove the file; refusing to read it as defaults`,
      );
    }
    const verdict = storeFileSchema.safeParse(parsed);
    if (!verdict.success) {
      throw new VaultPrefsStoreError(
        `${this.path} does not match the vault-prefs shape — fix or remove the file`,
      );
    }
    return verdict.data;
  }

  write(prefs: VaultPrefs): void {
    stagedWriteFileSync(this.path, `${JSON.stringify(prefs, null, 2)}\n`);
  }
}
