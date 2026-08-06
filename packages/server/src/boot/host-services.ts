// ---------------------------------------------------------------------------
// HostServices — the live services a handler acts through, handed IN rather
// than reached for. Handler groups take this object (narrowed to the fields
// each one uses) instead of importing the module-level getX() accessors, so a
// host that runs many tenants inside ONE module scope can give every tenant
// its own set instead of sharing one process-global.
//
// createHostServices() is the NODE host's set: property getters over the
// process singletons rather than captured instances. "Reset app data" drops
// every one of those singletons and the next getX() builds a fresh one, while
// the handler map collectHandlers() produced at boot lives on for the life of
// the process — snapshotting the instances here would leave the handlers
// reading closed stores and writing through a torn-down VaultManager.
// ---------------------------------------------------------------------------

import type { AgentPorts } from "@repo/agent/extension";
import type { BundledResources } from "@repo/agent/setup";
import { getExecutorDaemon, type ExecutorDaemon } from "@repo/connectors/executor-daemon";
import { getSecretStore, type SecretStore } from "@repo/storage/secrets";
import { getSyncAccount, type SyncAccount } from "@repo/sync/sync-account";
import { getVaultManager, type VaultManager } from "@repo/vault/vault";

import { getAgentPorts, getBundledResources } from "./agent-wiring";
import {
  getConfirmationBroker,
  type ConfirmationBroker,
} from "../agent-confirm/confirmation-broker";
import { getCaptureManager, type CaptureManager } from "../capture/capture-manager";
import { getDelegationManager, type DelegationManager } from "../delegation/delegation-manager";
import { getKnowledgeManager, type KnowledgeManager } from "../knowledge/knowledge-manager";
import { getNotifications, type NotificationsManager } from "../notifications";
import { getHostOptions, getPlatform } from "../platform-instance";
import { getRestoreManager, type RestoreManager } from "../restore/restore-manager";
import { getRoutinesManager, type RoutinesManager } from "../routines/routines-manager";
import {
  getRemoteAccessManager,
  type RemoteAccessManager,
} from "../transport/remote-access-manager";
import { getUiState, type UiStateManager } from "../ui-state";
import type { HostOptions, HostPlatform } from "../platform";

export type HostServices = {
  readonly platform: HostPlatform;
  readonly options: HostOptions;
  readonly vault: VaultManager;
  readonly knowledge: KnowledgeManager;
  readonly delegations: DelegationManager;
  readonly routines: RoutinesManager;
  readonly restore: RestoreManager;
  readonly capture: CaptureManager;
  readonly confirmations: ConfirmationBroker;
  readonly notifications: NotificationsManager;
  readonly uiState: UiStateManager;
  readonly secrets: SecretStore;
  readonly account: SyncAccount;
  readonly executorDaemon: ExecutorDaemon;
  readonly remoteAccess: RemoteAccessManager;
  readonly agentPorts: AgentPorts;
  readonly bundledResources: BundledResources;
};

/** The node host's services: one accessor per field, resolved on read (see
 * the header — the singletons behind them are rebuilt by "Reset app data"). */
export function createHostServices(): HostServices {
  return {
    get platform() {
      return getPlatform();
    },
    get options() {
      return getHostOptions();
    },
    get vault() {
      return getVaultManager();
    },
    get knowledge() {
      return getKnowledgeManager();
    },
    get delegations() {
      return getDelegationManager();
    },
    get routines() {
      return getRoutinesManager();
    },
    get restore() {
      return getRestoreManager();
    },
    get capture() {
      return getCaptureManager();
    },
    get confirmations() {
      return getConfirmationBroker();
    },
    get notifications() {
      return getNotifications();
    },
    get uiState() {
      return getUiState();
    },
    get secrets() {
      return getSecretStore();
    },
    get account() {
      return getSyncAccount();
    },
    get executorDaemon() {
      return getExecutorDaemon();
    },
    get remoteAccess() {
      return getRemoteAccessManager();
    },
    get agentPorts() {
      return getAgentPorts();
    },
    get bundledResources() {
      return getBundledResources();
    },
  };
}
