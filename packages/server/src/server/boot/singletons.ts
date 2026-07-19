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
//   vault            ──▶ delegation
//   (paths)          ──▶ executorDaemon
//   executorDaemon   ──▶ agentPorts
//   auth.json        ──▶ authStorage
//
// The notifiers are composed here (buildHostNotifiers) and installed BEFORE any
// piece that fires them is constructed. Only the LOW-LEVEL pieces that must not
// import the event registry get a slot (json-store, vault); everything else
// calls the typed emitEvent directly — see notifier-wiring.ts.
// ---------------------------------------------------------------------------

import { emitEvent } from "../events";
import { getCheckpointManager } from "../chat-undo/checkpoint-manager";
import { getDelegationManager } from "../delegation/delegation-manager";
import { getExecutorDaemon } from "../connectors/executor-daemon";
import { getKnowledgeManager } from "../knowledge/knowledge-manager";
import { getNotifications } from "../notifications";
import { getSecretStore } from "@repo/storage/secrets";
import { getSyncCoordinator } from "../sync/sync-coordinator";
import { getVaultManager } from "../vault/vault";
import { setStoreRecoveryNotifier } from "@repo/storage/json-store";
import type { HostNotifiers } from "./notifier-wiring";

/** Compose the host notifiers for the registry-free low-level pieces. Each
 * fans into the IPC event bus / the notifications manager — the only place in
 * the host that both owns these closures and is allowed to import both ends. */
function buildHostNotifiers(): HostNotifiers {
  return {
    storeRecovery: (event) => getNotifications().notifyStoreRecovered(event),
    vaultChange: (root, kind) => {
      // A `save` (autosave content overwrite) keeps the knowledge index live but
      // must NOT broadcast — the user's own typing generates zero vault-changed
      // traffic (vault liveness — CLAUDE.md § Decisions); the open-note
      // watcher covers the open file's own
      // reloads. A `refresh` is a structural/external/on-demand change: broadcast
      // so the sidebar re-lists and the editor reloads, and reindex.
      if (kind === "refresh") emitEvent("onVaultChanged", { root });
      getKnowledgeManager().scheduleRefresh();
    },
  };
}

/** Force the initial, dependency-ordered construction of the core host
 * singletons and install the notifier composition. Requires installHostRuntime()
 * to have run (platform installed). Returns the composed notifiers for the
 * caller's start() wiring (vaultChange is installed there, post-ensureReady);
 * every service is reached afterward through its getX() accessor. Constructs
 * the pi-free, read-free core singletons eagerly in order. */
export function constructHostSingletons(): HostNotifiers {
  const notifiers = buildHostNotifiers();
  // Quarantine notices must be user-visible before any store is read; this is
  // the json-store default recovery seam (a plain callback — json-store never
  // imports the event registry).
  setStoreRecoveryNotifier(notifiers.storeRecovery);

  // Eager, dependency-ordered construction. Every constructor here allocates
  // only (disk reads stay lazy inside JsonStore), so this changes nothing
  // observable — it just materializes the graph in one place, in order, with
  // notifiers already installed. Two pieces are deliberately NOT eager:
  //   - uiState: nothing at boot reads it; kept lazy so ui-state.json keeps
  //     its original first-access timing.
  //   - authStorage: it is a pi call, which must wait for configurePaths() in
  //     start(); constructing it here would run before that.
  // Both stay reachable via their live getX() accessors.
  getSecretStore(); // platform.secretCipher
  getNotifications(); // platform.notify
  getVaultManager(); // paths (watcher stays off until start() wires it post-ensureReady)
  getKnowledgeManager(); // vault
  getDelegationManager(); // vault (push channels wire to emitEvent at construction)
  getCheckpointManager(); // shared snapshot store (capture channel wires to emitEvent)
  getExecutorDaemon(); // paths
  getSyncCoordinator(); // sync account stores (allocation only; disk stays lazy)

  return notifiers;
}
