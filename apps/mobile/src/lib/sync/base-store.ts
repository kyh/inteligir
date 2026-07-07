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
import { parseVaultManifest } from "@repo/core/sync/manifest";

/** A tiny synchronous text file. `read` returns `null` when the file is absent. */
export type JsonFile = {
  read(): string | null;
  write(text: string): void;
};

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
      return parseVaultManifest(raw); // boundary validation is core's (shared)
    },
    save: (manifest) => {
      file.write(JSON.stringify(manifest));
    },
  };
}
