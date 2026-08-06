// ---------------------------------------------------------------------------
// The cloud host's handler map: what is implemented, and — in one table — what
// is not yet.
//
// Everything this host owns is answered for real: the app phase and the two
// JsonStores over the Durable Object's KV, the vault (./vault-handlers) whose
// manifest and bytes this object owns, the knowledge index
// (./knowledge-handlers) over that vault, the agent (../agent/agent-handlers)
// and the background work over it (../background/background-handlers). Every
// other method is registered as a SHIM that throws through `unavailable()`,
// naming the feature it waits on — never a silent `[]` (see ShimRegistrar for
// why).
//
// `CLOUD_SHIMS` is the migration backlog. Each group is roughly one later
// commit, and a group empties as that commit lands.
// ---------------------------------------------------------------------------

import type { AppState } from "@repo/bridge/app-state";
import type { HostMethod } from "@repo/bridge/ipc-registry";
import { registerAgentHandlers, type AgentServices } from "../agent/agent-handlers";
import {
  registerBackgroundHandlers,
  type BackgroundServices,
} from "../background/background-handlers";
import { unavailable, type HandlerRegistrar, type ShimRegistrar } from "./handler-registry";
import type { HostEvents } from "./host-events";
import { registerKnowledgeHandlers } from "./knowledge-handlers";
import type { UserKnowledge } from "./knowledge/user-knowledge";
import type { CloudStores } from "./stores";
import { registerVaultHandlers } from "./vault-handlers";
import type { UserVault } from "./vault/user-vault";

type CloudHostServices = {
  readonly stores: CloudStores;
  readonly events: HostEvents;
  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  readonly agent: AgentServices;
  readonly background: BackgroundServices;
};

/**
 * The cloud host's app phase. There is no setup step — no CLI to install, no
 * local runtime to provision — and no effect that can fail, so `starting` and
 * `error` are states this host cannot be in and does not model. `agent` tracks
 * the container: a turn is dispatched and reported back, so "busy" is what the
 * last report said, not what an in-process session is doing.
 */
export function cloudAppState(agentBusy: boolean): AppState {
  return { phase: "ready", agent: agentBusy ? "busy" : "idle" };
}

type ShimGroup = {
  /** Names the gap in the thrown message — keep it the feature, not the file. */
  readonly feature: string;
  readonly methods: readonly HostMethod[];
};

/** The migration backlog: every host method with no cloud implementation. */
export const CLOUD_SHIMS: readonly ShimGroup[] = [
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
  // is the only writer so there is nothing to watch. `probeNotePrivacy` is
  // retired too — `private: true` is not a feature of this host, so a probe
  // would answer a question nothing here asks.
  {
    feature: "the vault",
    methods: ["chooseVaultRoot", "probeNotePrivacy", "setWatchedNote"],
  },
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
  // The account channels are the desktop shell's own: a cloud client is
  // already signed in — the session is what named this object — so there is
  // nothing here to sign in to, point at a server, or sign out of. Remote
  // access will not be implemented but RETIRED: there is no home machine for a
  // phone to pair with. Both are shimmed rather than deleted because the
  // registry still declares them.
  {
    feature: "account",
    methods: [
      "getAccountState",
      "setAccountServerUrl",
      "syncSignIn",
      "syncRequestPasswordReset",
      "syncSignUp",
      "syncSocialSignIn",
      "getAccountCapabilities",
      "syncSignOut",
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
  const appState = (): AppState => cloudAppState(services.agent.runner.agentBusy());

  handle("getAppState", appState);
  handle("transition", (event) => {
    switch (event.type) {
      case "SETUP":
      case "RETRY":
        // Idempotent. There is nothing to set up and no failed effect to leave
        // behind, so both answer with the phase this host is already in —
        // re-announced, so a client that transitioned and waited is not
        // stranded on an event that never comes.
        services.events.emit("onAppState", appState());
        return;
      case "NEW_SESSION":
        services.agent.runner.newSession();
        services.events.emit("onAppState", appState());
        return;
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

  registerVaultHandlers(handle, services.vault, services.knowledge);
  registerKnowledgeHandlers(handle, services.knowledge, services.vault);
  registerAgentHandlers(handle, services.agent);
  registerBackgroundHandlers(handle, services.background);

  for (const group of CLOUD_SHIMS) {
    for (const method of group.methods) shim(method, group.feature);
  }
}
