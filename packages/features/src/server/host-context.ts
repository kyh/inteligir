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
//   vault + notifiers ──▶ delegation
//   (paths)          ──▶ executorDaemon
//   executorDaemon   ──▶ agentPorts
//   auth.json        ──▶ authStorage
//
// The notifiers are composed here (buildHostNotifiers) and installed BEFORE any
// piece that fires them is constructed, so delegation gets its two at
// construction and inline-AI reads its one at call time — no post-hoc
// setXNotifier mutation from app-machine.
// ---------------------------------------------------------------------------

import { emitEvent } from "./events";
import { getCheckpointManager } from "./checkpoints/checkpoint-manager";
import { getDelegationManager } from "./delegation/delegation-manager";
import { getExecutorDaemon } from "./executor/executor-daemon";
import { getKnowledgeManager } from "./knowledge/knowledge-manager";
import { getNotifications } from "./notifications";
import { getSecretStore } from "./secrets";
import { getSyncCoordinator } from "./sync/sync-coordinator";
import { getVaultManager } from "./vault/vault";
import { setStoreRecoveryNotifier } from "./lib/json-store";
import { installHostNotifiers, type HostNotifiers } from "./host-notifiers";

/** Compose the five host notifiers. Each fans into the IPC event bus / the
 * notifications manager — the only place in the host that both owns these
 * closures and is allowed to import the event registry. */
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
    delegationsChanged: (delegations) => emitEvent("onDelegationsUpdated", { delegations }),
    delegationStream: (id, text) => emitEvent("onDelegationStreamed", { id, text }),
    agentEditCaptured: (event) => emitEvent("onAgentEditCaptured", event),
    inlineAiStream: (requestId, delta) => emitEvent("onAiStreamed", { requestId, delta }),
    captureApply: (event) => emitEvent("onCaptureApply", event),
    deepLinkNav: (event) => emitEvent("onDeepLinkNav", event),
    syncStateChanged: (state) => emitEvent("onSyncStateChanged", state),
  };
}

/** Force the initial, dependency-ordered construction of the core host
 * singletons and install the notifier composition. Requires installHostRuntime()
 * to have run (platform installed). Returns the composed notifiers for the
 * caller's start() wiring; every service is reached afterward through its
 * getX() accessor. Constructs the pi-free, read-free core singletons eagerly in
 * order; the notifier-firing pieces receive their notifiers because
 * installHostNotifiers() runs first. */
export function constructHostSingletons(): HostNotifiers {
  const notifiers = buildHostNotifiers();
  installHostNotifiers(notifiers);
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
  getDelegationManager(); // vault + delegation notifiers (installed above)
  getCheckpointManager(); // shared snapshot store + checkpoint notifier (installed above)
  getExecutorDaemon(); // paths
  getSyncCoordinator(); // sync account stores (allocation only; disk stays lazy)

  return notifiers;
}
