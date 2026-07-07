// ---------------------------------------------------------------------------
// BaseStore adapter — persistence for the last-synced BASE manifest (the 3-way
// anchor @repo/core's `reconcile` diffs against). The engine's `BaseStore` is
// synchronous (`load(): VaultManifest | null`, `save(m)`), so this adapter wraps
// a minimal synchronous `JsonFile` port.
//
// A base is a PURE CACHE of the last sync — a missing/legacy/corrupt file just
// means "re-sync from empty", never data loss — so `load` returns `null` on any
// unreadable/malformed content and the engine starts from an empty base. The
// JSON parse + boundary validation lives here (no `expo-*` import), so it is
// unit-testable on node against an in-memory `JsonFile` fake.
// ---------------------------------------------------------------------------

import type { BaseStore } from "@repo/core/sync/base-store";
import type { VaultManifest } from "@repo/core/sync/manifest";
import { isValidHash, type VaultFile } from "@repo/core/sync/vault-file";
import { isRecord } from "@repo/core/sync/guards";

/** A tiny synchronous text file. `read` returns `null` when the file is absent. */
export type JsonFile = {
  read(): string | null;
  write(text: string): void;
};

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseVaultFile(raw: unknown): VaultFile | null {
  if (!isRecord(raw)) return null;
  const { path, contentHash, version, size } = raw;
  if (typeof path !== "string" || path === "") return null;
  if (typeof contentHash !== "string" || !isValidHash(contentHash)) return null;
  if (!isNonNegativeInt(version) || !isNonNegativeInt(size)) return null;
  return { path, contentHash, version, size };
}

function parseManifest(raw: unknown): VaultManifest | null {
  if (!isRecord(raw)) return null;
  const { vaultId, generation, files } = raw;
  if (typeof vaultId !== "string" || !isNonNegativeInt(generation) || !Array.isArray(files)) {
    return null;
  }
  const parsed: VaultFile[] = [];
  for (const entry of files) {
    const file = parseVaultFile(entry);
    if (!file) return null;
    parsed.push(file);
  }
  return { vaultId, generation, files: parsed };
}

/** Adapt a `JsonFile` to the engine's `BaseStore` port. */
export function createBaseStore(file: JsonFile): BaseStore {
  return {
    load: () => {
      const text = file.read();
      if (text === null || text === "") return null;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return null; // corrupt cache → re-sync from empty
      }
      return parseManifest(raw);
    },
    save: (manifest) => {
      file.write(JSON.stringify(manifest));
    },
  };
}
