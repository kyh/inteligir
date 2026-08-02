import type { VaultManifest } from "./manifest";
import { parseVaultManifest } from "./manifest";
import { isRecord } from "./guards";

// ---------------------------------------------------------------------------
// BaseStore — persistence for the last-synced BASE manifest, the 3-way anchor
// `reconcile` diffs against. Injected into `SyncEngine` so the same engine runs
// over a node JsonStore (desktop) or an async device store (mobile) alike.
// `load` returns `null` when there is no anchor yet (first sync / empty); the
// engine treats that as an empty base.
// ---------------------------------------------------------------------------

/**
 * The persisted anchor: a coordinator manifest snapshot PLUS the local vault
 * root it was taken against. The root is part of the anchor's identity — point
 * the app at a different folder and every path the old folder held is absent
 * from the new one, which `reconcile` would read as a pile of local deletes and
 * fan out to every device. `vaultRoot` is `null` when the anchor names no root:
 * a platform whose vault cannot move (mobile), or a stored value the parser
 * could not read — which an engine that DOES have a root must treat as a
 * mismatch, never as a match.
 */
export type StoredBase = VaultManifest & { readonly vaultRoot: string | null };

export interface BaseStore {
  /** The last-synced anchor, or `null` on first sync (no anchor yet). */
  load(): StoredBase | null;
  /** Persist the new anchor after a converged pass. */
  save(base: StoredBase): void;
}

/** A process-memory `BaseStore` — the reference implementation + test double. */
export class InMemoryBaseStore implements BaseStore {
  private current: StoredBase | null = null;

  load(): StoredBase | null {
    return this.current;
  }

  save(base: StoredBase): void {
    this.current = base;
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
      return parseStoredBase(raw); // boundary validation, never throws
    },
    save: (base) => {
      file.write(JSON.stringify(base));
    },
  };
}

/** Decode a `StoredBase` from untrusted data, or null if the manifest part is
 * malformed. A missing or non-string `vaultRoot` reads as `null` — "no root
 * recorded", which the engine refuses to match against a live root. */
function parseStoredBase(raw: unknown): StoredBase | null {
  const manifest = parseVaultManifest(raw);
  if (manifest === null) return null;
  const vaultRoot = isRecord(raw) ? raw.vaultRoot : null;
  return { ...manifest, vaultRoot: typeof vaultRoot === "string" ? vaultRoot : null };
}
