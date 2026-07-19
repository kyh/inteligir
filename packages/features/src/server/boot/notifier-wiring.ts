// ---------------------------------------------------------------------------
// Host notifier composition — the plain callbacks the composition root
// (host-context.ts, driven by create-host.ts) builds ONCE for the LOW-LEVEL
// pieces that must never import the IPC event registry themselves: json-store
// (storeRecovery, installed via setStoreRecoveryNotifier) and the vault
// (vaultChange, installed via setVaultChangeNotifier in create-host's start()).
// Both installation seams are module-scoped in their targets, so a manager
// rebuilt after a logout/login reset keeps firing them.
//
// Everything higher-level (delegation, checkpoints, inline-AI, capture,
// deep-link, sync) calls the typed `emitEvent` in ./events directly — events.ts
// is a leaf module, so that import carries no cycle risk. A slot belongs here
// ONLY when the firing piece must stay registry-free.
// ---------------------------------------------------------------------------

import type { VaultChangeKind } from "../vault/vault";
import type { StoreRecoveryEvent } from "../storage/json-store";

/** The host notifier slots, composed by the host and fired by the low-level
 * pieces. Each is a plain callback that fans into `emitEvent(...)` / the
 * notifications manager — that wiring lives in the composition root, not here. */
export type HostNotifiers = {
  /** A JsonStore quarantined a data file (json-store's default recovery seam). */
  storeRecovery: (event: StoreRecoveryEvent) => void;
  /** The vault changed. `refresh` broadcasts onVaultChanged + reindexes; `save`
   * (an autosave content overwrite) reindexes only — no broadcast (vault
   * liveness — CLAUDE.md § Decisions). */
  vaultChange: (root: string, kind: VaultChangeKind) => void;
};
