// ---------------------------------------------------------------------------
// The host's handler map: what is implemented, and — in two tables — what is
// not.
//
// Everything this host owns is answered for real: the app phase and the two
// JsonStores over the Durable Object's KV, the vault (./vault-handlers) whose
// manifest and bytes this object owns, the knowledge index
// (./knowledge-handlers) over that vault, the agent (../agent/agent-handlers)
// and the background work over it (../background/background-handlers), the
// editor's AI (../ai/ai-handlers), voice (../voice/voice-handlers), deep-link
// capture (../capture/capture-handlers) and skills (../skills/skills-handlers).
//
// The rest is registered as a SHIM that throws. `CLOUD_SHIMS` is the BACKLOG —
// a capability this host will have, grouped by the commit that will bring it —
// and a group empties as that commit lands. A shim is never a silent `[]` (see
// ShimRegistrar for why).
//
// There is no second table for capabilities this host has DECIDED against, and
// that is not an omission: retiring a capability means deleting its channel,
// which the no-dead-channels guard already makes a complete operation. A shim
// that says "this will never exist" would leave a name in the registry for the
// sole purpose of refusing it.
// ---------------------------------------------------------------------------

import type { AppState } from "@repo/bridge/app-state";
import type { HostMethod } from "@repo/bridge/ipc-registry";
import { registerAgentHandlers, type AgentServices } from "../agent/agent-handlers";
import { registerAiHandlers } from "../ai/ai-handlers";
import type { TextGenerator } from "../ai/text-generator";
import {
  registerBackgroundHandlers,
  type BackgroundServices,
} from "../background/background-handlers";
import { registerCaptureHandlers, type CaptureServices } from "../capture/capture-handlers";
import { registerSkillsHandlers } from "../skills/skills-handlers";
import { registerVoiceHandlers } from "../voice/voice-handlers";
import type { VoiceComposition } from "../voice/voice-composition";
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
  readonly ai: TextGenerator;
  readonly voice: VoiceComposition;
  readonly capture: CaptureServices;
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

/** The migration backlog: every host method with no cloud implementation yet. */
export const CLOUD_SHIMS: readonly ShimGroup[] = [
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
    ],
  },
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
  registerAiHandlers(handle, services.ai);
  registerVoiceHandlers(handle, services.voice);
  registerCaptureHandlers(handle, services.capture);
  registerSkillsHandlers(handle, services.vault);

  for (const group of CLOUD_SHIMS) {
    for (const method of group.methods) shim(method, group.feature);
  }
}
