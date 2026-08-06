// ---------------------------------------------------------------------------
// The cloud host's handler map: what is implemented, and — in one table — what
// is not yet.
//
// Sixteen methods are answered for real: the app phase and the two JsonStores
// over the Durable Object's KV, plus the vault (./vault-handlers), whose
// manifest and bytes this object now owns. Every other method is registered as
// a SHIM that throws through `unavailable()`, naming the feature it waits on —
// never a silent `[]` (see ShimRegistrar for why).
//
// `CLOUD_SHIMS` is the migration backlog. Each group is roughly one later
// commit, and a group empties as that commit lands.
// ---------------------------------------------------------------------------

import type { AppState } from "@repo/bridge/app-state";
import type { HostMethod } from "@repo/bridge/ipc-registry";
import { unavailable, type HandlerRegistrar, type ShimRegistrar } from "./handler-registry";
import type { HostEvents } from "./host-events";
import type { CloudStores } from "./stores";
import { registerVaultHandlers } from "./vault-handlers";
import type { UserVault } from "./vault/user-vault";

type CloudHostServices = {
  readonly stores: CloudStores;
  readonly events: HostEvents;
  readonly vault: UserVault;
};

/**
 * The cloud host's app phase. There is no setup step — no CLI to install, no
 * local agent to log in — and no effect that can fail, so `starting` and
 * `error` are states this host cannot be in and does not model. `agent` is
 * idle because there is no agent yet.
 */
const CLOUD_APP_STATE: AppState = { phase: "ready", agent: "idle" };

type ShimGroup = {
  /** Names the gap in the thrown message — keep it the feature, not the file. */
  readonly feature: string;
  readonly methods: readonly HostMethod[];
};

/** The migration backlog: every host method with no cloud implementation. */
export const CLOUD_SHIMS: readonly ShimGroup[] = [
  {
    feature: "the agent",
    methods: [
      "sendAgentCommand",
      "getAgentHistory",
      "listChatSessions",
      "readChatSession",
      "reauthenticate",
      "setFauxAgentScript",
      "getAgentSystemPrompt",
    ],
  },
  {
    feature: "the AI provider",
    methods: [
      "getAiProviderSettings",
      "setAiProviderConfig",
      "connectAiProvider",
      "disconnectAiProvider",
    ],
  },
  {
    feature: "voice",
    methods: [
      "isTtsAvailable",
      "setVoiceApiKey",
      "ttsSend",
      "ttsFlush",
      "ttsInterrupt",
      "startStt",
      "sendSttAudio",
      "stopStt",
    ],
  },
  // What is left of the vault group is being RETIRED, not implemented: there
  // is one vault per account and no folder to choose, and the Durable Object
  // is the only writer so there is nothing to watch. `probeNotePrivacy` waits
  // on the agent — it is the fail-closed gate that keeps a private note out of
  // an AI surface, and answering it before any AI surface exists would be
  // answering "public" to a question nobody is yet entitled to ask.
  {
    feature: "the vault",
    methods: ["chooseVaultRoot", "probeNotePrivacy", "setWatchedNote"],
  },
  {
    feature: "the knowledge index",
    methods: [
      "getBacklinks",
      "getForwardLinks",
      "getLinkGraph",
      "searchVault",
      "listWikiTargets",
      "listVaultTasks",
      "toggleVaultTask",
    ],
  },
  {
    feature: "delegation",
    methods: [
      "createDelegation",
      "listDelegations",
      "cancelDelegation",
      "restoreDelegationSnapshot",
    ],
  },
  {
    feature: "routines",
    methods: [
      "listRoutines",
      "upsertRoutine",
      "deleteRoutine",
      "runRoutineNow",
      "restoreRoutineRun",
    ],
  },
  { feature: "AI-edit undo", methods: ["restoreAgentEdits"] },
  { feature: "agent confirmations", methods: ["resolveAgentConfirmation"] },
  { feature: "deep-link capture", methods: ["ackCapture", "takePendingDeepLinkNav"] },
  {
    feature: "editor AI",
    methods: [
      "generateInlineAi",
      "cancelInlineAi",
      "classifyAiIntent",
      "generateGhostText",
      "cancelGhostText",
      "listGhostModels",
    ],
  },
  {
    feature: "connectors",
    methods: [
      "executorStatus",
      "listExecutorIntegrations",
      "detectExecutorIntegration",
      "listExecutorConnections",
      "createExecutorOAuthClient",
      "ensureGoogleOAuthClient",
      "installConnector",
      "uninstallConnector",
      "getPendingConnectorAuth",
    ],
  },
  // Vault sync and remote access are the two groups that will not be
  // implemented but RETIRED: a cloud workspace reads the vault the coordinator
  // already holds, and there is no home machine for a phone to pair with. They
  // are shimmed rather than deleted because the registry still declares them.
  {
    feature: "vault sync",
    methods: [
      "getSyncState",
      "setSyncConfig",
      "syncSignIn",
      "syncRequestPasswordReset",
      "syncSignUp",
      "syncSocialSignIn",
      "getAccountCapabilities",
      "syncSignOut",
      "syncNow",
      "getSyncDevices",
      "createSyncPairingOffer",
      "revokeSyncDevice",
      "reconnectSyncVault",
      "disconnectSyncVault",
    ],
  },
  {
    feature: "remote access",
    methods: [
      "getRemoteAccessState",
      "setRemoteAccessConfig",
      "createPairingToken",
      "revokeRemoteDevice",
    ],
  },
  { feature: "skills", methods: ["listSkills", "createSkill"] },
  { feature: "integrations", methods: ["listIntegrations", "repairIntegrations"] },
];

export function registerCloudHandlers(
  handle: HandlerRegistrar,
  shim: ShimRegistrar,
  services: CloudHostServices,
): void {
  handle("getAppState", () => CLOUD_APP_STATE);
  handle("transition", (event) => {
    switch (event.type) {
      case "SETUP":
      case "RETRY":
        // Idempotent. There is nothing to set up and no failed effect to leave
        // behind, so both answer with the phase this host is already in —
        // re-announced, so a client that transitioned and waited is not
        // stranded on an event that never comes.
        services.events.emit("onAppState", CLOUD_APP_STATE);
        return;
      // Two of the four events reach subsystems that do not exist yet, so this
      // one handler is part real and part gap.
      case "NEW_SESSION":
        return unavailable("agent sessions");
      case "RESET_APP_DATA":
        return unavailable("app-data reset");
    }
  });

  handle("getUiState", () => services.stores.uiState.read());
  handle("setUiState", ({ key, value }) => {
    services.stores.uiState.update((current) => {
      // `undefined` removes the key: JSON.stringify would drop it anyway, so
      // removal is modelled rather than left to the serializer.
      if (value === undefined) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: value };
    });
  });

  handle("getNotificationSettings", () => services.stores.notifications.read());
  handle("updateNotificationSettings", (patch) =>
    services.stores.notifications.update((current) => ({
      ...current,
      // Never spread the patch whole: the wire type admits
      // `enabled: undefined`, which would overwrite the live setting.
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    })),
  );

  registerVaultHandlers(handle, services.vault);

  for (const group of CLOUD_SHIMS) {
    for (const method of group.methods) shim(method, group.feature);
  }
}
