// ---------------------------------------------------------------------------
// Host boot-order bootstrap — the composition root's dependency-ordered
// construction of the backend singletons. createHost() sequences over the
// process-global getX() singletons; this module owns the ONE place that forces
// their initial construction in order, with the notifier composition installed
// FIRST so the notifier-firing pieces receive their notifiers at construction.
//
// getX() stays THE way to reach a service (here and everywhere in server/**):
// resetX() + the lazy getX() rebuild an individual singleton on a logout/login
// cycle, so a captured reference would go stale. This bootstrap only forces the
// initial ordered materialization; every later read goes back through getX().
//
// Dependency order (leaves first). Each edge is "needs the piece to its left to
// be constructable":
//   platform/options ──▶ secrets, notifications, bundledResources
//   secrets          ──▶ uiState
//   (paths)          ──▶ vault ──▶ knowledge
//   vault, restore   ──▶ delegation
//   (paths)          ──▶ executorDaemon
//   executorDaemon   ──▶ agentPorts
//   auth.json        ──▶ authStorage
//
// The notifiers for the LOW-LEVEL pieces that must never import the IPC event
// registry themselves are composed here and installed BEFORE any piece that
// fires them is constructed: json-store's store-recovery seam (installed
// below) and the vault's change callback (returned — create-host's start()
// installs it post-ensureReady). Both installation seams are module-scoped in
// their targets, so a manager rebuilt after a logout/login reset keeps firing
// them. Everything higher-level (delegation, checkpoints, inline-AI, capture,
// deep-link, sync) calls the typed `emitEvent` in ../events directly —
// events.ts is a leaf module, so that import carries no cycle risk. A notifier
// belongs here ONLY when the firing piece must stay registry-free.
// ---------------------------------------------------------------------------

import { emitEvent } from "../events";
import { getRestoreManager } from "../restore/restore-manager";
import { getDelegationManager } from "../delegation/delegation-manager";
import { getRoutinesManager } from "../routines/routines-manager";
import { getExecutorDaemon } from "@repo/connectors/executor-daemon";
import { getKnowledgeManager } from "../knowledge/knowledge-manager";
import { getNotifications } from "../notifications";
import { getSecretStore } from "@repo/storage/secrets";
import { getSyncCoordinator } from "@repo/sync/sync-coordinator";
import { getVaultManager, type VaultChangeKind } from "@repo/vault/vault";
import { setStoreRecoveryNotifier } from "@repo/storage/json-store";

/** The vault-change notifier create-host's start() installs post-ensureReady.
 * A `save` (autosave content overwrite) keeps the knowledge index live but
 * must NOT broadcast — the user's own typing generates zero vault-changed
 * traffic (vault liveness — CLAUDE.md § Decisions); the open-note watcher
 * covers the open file's own reloads. A `refresh` is a structural/external/
 * on-demand change: broadcast so the sidebar re-lists and the editor reloads,
 * and reindex. */
function vaultChange(root: string, kind: VaultChangeKind): void {
  if (kind === "refresh") emitEvent("onVaultChanged", { root });
  getKnowledgeManager().scheduleRefresh();
}

/** Force the initial, dependency-ordered construction of the core host
 * singletons and install the notifier composition. Requires installHostRuntime()
 * to have run (platform installed). Returns the vault-change notifier for the
 * caller's start() wiring (installed there, post-ensureReady); every service
 * is reached afterward through its getX() accessor. Constructs the pi-free,
 * read-free core singletons eagerly in order. */
export function constructHostSingletons(): (root: string, kind: VaultChangeKind) => void {
  // Quarantine notices must be user-visible before any store is read; this is
  // the json-store default recovery seam (a plain callback — json-store never
  // imports the event registry).
  setStoreRecoveryNotifier((event) => getNotifications().notifyStoreRecovered(event));

  // Eager, dependency-ordered construction. Every constructor here allocates
  // only (disk reads stay lazy inside JsonStore), so eager construction costs
  // nothing observable — it just materializes the graph in one place, in
  // order, with notifiers already installed. Two pieces are deliberately NOT
  // eager:
  //   - uiState: nothing at boot reads it; kept lazy so ui-state.json is not
  //     touched until something actually needs it.
  //   - authStorage: it is a pi call, which must wait for configurePaths() in
  //     start(); constructing it here would run before that.
  // Both stay reachable via their live getX() accessors.
  getSecretStore(); // platform.secretCipher
  getNotifications(); // platform.notify
  getVaultManager(); // paths (watcher stays off until start() wires it post-ensureReady)
  getKnowledgeManager(); // vault
  getRestoreManager(); // shared snapshot store (capture channel wires to emitEvent)
  getDelegationManager(); // vault + restore (push channels wire to emitEvent at construction)
  getRoutinesManager(); // vault + restore + the shared background-turn lock (same wiring story)
  getExecutorDaemon(); // paths
  getSyncCoordinator(); // sync account stores (allocation only; disk stays lazy)

  return vaultChange;
}
