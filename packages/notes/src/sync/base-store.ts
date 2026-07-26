import type { VaultManifest } from "./manifest";
import { parseVaultManifest } from "./manifest";

// ---------------------------------------------------------------------------
// BaseStore — persistence for the last-synced BASE manifest, the 3-way anchor
// `reconcile` diffs against. Injected into `SyncEngine` so the same engine runs
// over a node JsonStore (desktop) or an async device store (mobile) alike.
// `load` returns `null` when there is no anchor yet (first sync / empty); the
// engine treats that as an empty base.
// ---------------------------------------------------------------------------

export interface BaseStore {
  /** The last-synced anchor, or `null` on first sync (no anchor yet). */
  load(): VaultManifest | null;
  /** Persist the new anchor after a converged pass. */
  save(manifest: VaultManifest): void;
}

/** A process-memory `BaseStore` — the reference implementation + test double. */
export class InMemoryBaseStore implements BaseStore {
  private current: VaultManifest | null = null;

  load(): VaultManifest | null {
    return this.current;
  }

  save(manifest: VaultManifest): void {
    this.current = manifest;
  }
}

// ---------------------------------------------------------------------------
// JsonFile-backed BaseStore — the platform-neutral implementation both desktop
// and mobile wrap a tiny synchronous file port around. A base is a PURE CACHE
// of the last sync — a missing/malformed/corrupt file just means "re-sync from
// empty", never data loss — so `load` returns `null` on any unreadable or
// malformed content and the engine starts from an empty base. The JSON parse +
// boundary validation lives here (shared), so each platform only supplies
// `read`/`write` over its own storage.
// ---------------------------------------------------------------------------

/** A tiny synchronous text file. `read` returns `null` when the file is absent. */
export type JsonFile = {
  read(): string | null;
  write(text: string): void;
};

/** Adapt a `JsonFile` to the engine's `BaseStore` port. */
export function createJsonFileBaseStore(file: JsonFile): BaseStore {
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
      return parseVaultManifest(raw); // boundary validation, never throws
    },
    save: (manifest) => {
      file.write(JSON.stringify(manifest));
    },
  };
}
