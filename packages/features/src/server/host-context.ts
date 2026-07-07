// ---------------------------------------------------------------------------
// HostContext — the explicit backend object graph the composition root builds.
// createHost() used to be a sequencer over process-global getX() singletons
// with notifier slots mutated in two different places (here and app-machine's
// initMachine); this makes the graph a single, typed, dependency-ordered
// construction that owns the whole notifier composition.
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
//
// The fields are live getters, not captured references: resetX() + the lazy
// getX() rebuild an individual singleton on a logout/login cycle, so a captured
// HostContext would go stale. Reading through getX() keeps every field current
// while the eager block below still forces the initial, ordered construction.
// getX() therefore remains an accessor INTO this graph, with the same lazy
// fallback tests rely on.
// ---------------------------------------------------------------------------

import { emitEvent } from "./events";
import { getAuthStorage } from "./agent/auth";
import { getAgentPorts, getBundledResources } from "./lib/agent-lifecycle";
import { getDelegationManager, type DelegationManager } from "./delegation/delegation-manager";
import { getExecutorDaemon, type ExecutorDaemon } from "./executor/executor-daemon";
import { getKnowledgeManager, type KnowledgeManager } from "./knowledge/knowledge-manager";
import { getNotifications, type NotificationsManager } from "./notifications";
import { getSecretStore, type SecretStore } from "./secrets";
import { getSyncCoordinator, type SyncCoordinator } from "./sync/sync-coordinator";
import { getUiState, type UiStateManager } from "./ui-state";
import { getVaultManager, type VaultManager } from "./vault/vault";
import { getHostOptions, getPlatform } from "./platform-instance";
import { setStoreRecoveryNotifier } from "./lib/json-store";
import { installHostNotifiers, type HostNotifiers } from "./host-notifiers";
import type { AgentPorts } from "./agent/extension";
import type { BundledResources } from "./agent/setup";
import type { HostOptions, HostPlatform } from "./platform";
import type { AuthStorage } from "@repo/features/server/pi/pi-types";

/** The constructed backend object graph. Every field resolves to the live
 * singleton (see the getter note in the header). */
export type HostContext = {
  readonly platform: HostPlatform;
  readonly options: HostOptions;
  readonly notifiers: HostNotifiers;
  readonly secrets: SecretStore;
  readonly notifications: NotificationsManager;
  readonly uiState: UiStateManager;
  readonly vault: VaultManager;
  readonly knowledge: KnowledgeManager;
  readonly delegation: DelegationManager;
  readonly executorDaemon: ExecutorDaemon;
  readonly authStorage: AuthStorage;
  readonly bundledResources: BundledResources;
  readonly agentPorts: AgentPorts;
  readonly sync: SyncCoordinator;
};

/** Compose the five host notifiers. Each fans into the IPC event bus / the
 * notifications manager — the only place in the host that both owns these
 * closures and is allowed to import the event registry. */
function buildHostNotifiers(): HostNotifiers {
  return {
    storeRecovery: (event) => getNotifications().notifyStoreRecovered(event),
    vaultChange: (root) => {
      emitEvent("onVaultChanged", { root });
      getKnowledgeManager().scheduleRefresh();
    },
    delegationsChanged: (delegations) => emitEvent("onDelegationsUpdated", { delegations }),
    delegationStream: (id, text) => emitEvent("onDelegationStreamed", { id, text }),
    inlineAiStream: (requestId, delta) => emitEvent("onAiStreamed", { requestId, delta }),
    syncStateChanged: (state) => emitEvent("onSyncStateChanged", state),
  };
}

/** Build the host object graph. Requires installHostRuntime() to have run
 * (platform installed). Constructs the pi-free, read-free core singletons
 * eagerly in dependency order; the notifier-firing pieces receive their
 * notifiers because installHostNotifiers() runs first. */
export function buildHostContext(): HostContext {
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
  //   - uiState: its constructor reads + migrates ui-state.json; kept lazy so
  //     that read keeps its original first-access timing.
  //   - authStorage: it is a pi call, which must wait for configurePaths() in
  //     start(); constructing it here would run before that.
  // Both stay reachable via the live getters below.
  getSecretStore(); // platform.secretCipher
  getNotifications(); // platform.notify
  getVaultManager(); // paths (watcher stays off until start() wires it post-ensureReady)
  getKnowledgeManager(); // vault
  getDelegationManager(); // vault + delegation notifiers (installed above)
  getExecutorDaemon(); // paths
  getSyncCoordinator(); // sync account stores (allocation only; disk stays lazy)

  return {
    platform: getPlatform(),
    options: getHostOptions(),
    notifiers,
    get secrets() {
      return getSecretStore();
    },
    get notifications() {
      return getNotifications();
    },
    get uiState() {
      return getUiState();
    },
    get vault() {
      return getVaultManager();
    },
    get knowledge() {
      return getKnowledgeManager();
    },
    get delegation() {
      return getDelegationManager();
    },
    get executorDaemon() {
      return getExecutorDaemon();
    },
    get authStorage() {
      return getAuthStorage();
    },
    get bundledResources() {
      return getBundledResources();
    },
    get agentPorts() {
      return getAgentPorts();
    },
    get sync() {
      return getSyncCoordinator();
    },
  };
}
