import type { VaultManifest } from "./manifest";

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
